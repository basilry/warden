import { formatPolicyDecision } from "../policy.ts";
import { createAchLocalTool } from "../tools/ach-local.ts";
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
      const tool = createAchLocalTool();
      const policyContext = { runId: context.runId, taskId: task.id, role: "ach_analyst" as const };

      const openAction = createAction("open_case", "Hypothesis Analysis", "WRITE", input.frame);
      evaluateAndRecord(openAction, context, task.id, context.options.fixtureVariant === "skip_policy_for_write");
      let caseRecord = tool.openCaseFromFrame(input.frame);
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
      caseRecord = tool.addEvidenceFromBundles(caseRecord, input.bundles);
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
      caseRecord = tool.assessFromBundles(caseRecord, input.bundles);
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
      const result = tool.buildAchAnalysisResult(
        caseRecord,
        input.bundles.map((bundle) => bundle.id)
      );
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

function createAction(name: string, capability: string, risk: ToolAction["risk"], input: unknown): ToolAction {
  return {
    name,
    capability,
    server: "local-ach",
    risk,
    input
  };
}
