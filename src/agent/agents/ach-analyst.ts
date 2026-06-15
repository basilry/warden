import { formatPolicyDecision } from "../policy.ts";
import { invokeAchMcpTool } from "../mcp/ach-client.ts";
import type { ToolResult } from "../mcp/types.ts";
import type { AchAnalysisResult, Agent, CaseFrame, EvidenceBundle, ToolAction } from "../types.ts";
import { createHandoff } from "./base.ts";

export type AchAnalystInput = {
  frame: CaseFrame;
  bundles: EvidenceBundle[];
};

export function createAchAnalystAgent(): Agent<AchAnalystInput, AchAnalysisResult> {
  return {
    role: "ach_analyst",
    async run(task, context, input) {
      const policyContext = { runId: context.runId, taskId: task.id, role: "ach_analyst" as const };

      const openAction = createAction("open_case", "Hypothesis Analysis", "WRITE", input.frame);
      evaluateAndRecord(openAction, context, task.id, context.options.fixtureVariant === "skip_policy_for_write");
      let caseRecord = requireMcpOutput(
        await invokeAchMcpTool("open_case", { frame: input.frame }),
        openAction.name
      ).caseRecord;
      context.trace.record({
        phase: "tool_result",
        actor: "tool",
        taskId: task.id,
        ref: openAction.name,
        summary: `Opened ACH case ${caseRecord.id} with ${caseRecord.hypotheses.length} hypotheses.`,
        payload: caseRecord
      });

      const addEvidenceAction = createAction("add_evidence", "Hypothesis Analysis", "WRITE", input.bundles);
      evaluateAndRecord(addEvidenceAction, context, task.id, context.options.fixtureVariant === "skip_policy_for_write");
      caseRecord = requireMcpOutput(
        await invokeAchMcpTool("add_evidence", { caseRecord, bundles: input.bundles }),
        addEvidenceAction.name
      ).caseRecord;
      context.trace.record({
        phase: "tool_result",
        actor: "tool",
        taskId: task.id,
        ref: addEvidenceAction.name,
        summary: `Added ${caseRecord.evidence.length} evidence records with Admiralty reliability codes.`,
        payload: caseRecord.evidence
      });

      const assessAction = createAction("assess", "Hypothesis Analysis", "WRITE", input.bundles);
      evaluateAndRecord(assessAction, context, task.id, context.options.fixtureVariant === "skip_policy_for_write");
      caseRecord = requireMcpOutput(
        await invokeAchMcpTool("assess", { caseRecord, bundles: input.bundles }),
        assessAction.name
      ).caseRecord;
      context.trace.record({
        phase: "tool_result",
        actor: "tool",
        taskId: task.id,
        ref: assessAction.name,
        summary: `Assessed ${caseRecord.assessments.length} evidence x hypothesis cells.`,
        payload: caseRecord.assessments
      });

      const rankAction = createAction("rank_hypotheses", "Hypothesis Analysis", "READ", { caseId: caseRecord.id });
      evaluateAndRecord(rankAction, context, task.id, false);
      const result = requireMcpOutput(
        await invokeAchMcpTool("rank_hypotheses", {
          caseRecord,
          evidenceBundleIds: input.bundles.map((bundle) => bundle.id)
        }),
        rankAction.name
      ).result;
      context.trace.record({
        phase: "tool_result",
        actor: "tool",
        taskId: task.id,
        ref: rankAction.name,
        summary: `Ranked hypotheses. Survivors: ${result.survivors.join(", ")}.`,
        payload: result.ranked
      });

      return {
        status: "succeeded",
        output: result,
        summary: `ACH analysis completed with ${result.survivors.length} survivor(s).`,
        handoffs: [
          createHandoff("ach_analyst", "verifier", task.id, ["ach-analysis-result"], "ACH result ready for independent verification.")
        ]
      };

      function evaluateAndRecord(action: ToolAction, ctx: typeof context, taskId: string, skipPolicy: boolean): void {
        if (!skipPolicy) {
          const decision = ctx.policy.evaluate(action, policyContext);
          ctx.trace.record({
            phase: "policy_decision",
            actor: "policy",
            taskId,
            ref: action.name,
            summary: formatPolicyDecision(action, decision),
            payload: decision
          });
          ctx.policy.assertAllowed(decision);
        }

        ctx.trace.record({
          phase: "tool_call",
          actor: "tool",
          taskId,
          ref: action.name,
          summary: `Invoking ${action.server}:${action.name}.`,
          payload: action
        });
      }
    }
  };
}

function requireMcpOutput<T>(result: ToolResult<T>, toolName: string): T {
  if (result.status !== "succeeded" || !result.output) {
    throw new Error(`ACH MCP tool ${toolName} failed: ${result.error ?? result.status}`);
  }
  return result.output;
}

function createAction(name: string, capability: string, risk: ToolAction["risk"], input: unknown): ToolAction {
  return {
    name,
    capability,
    server: "local-ach",
    risk,
    input
  };
}
