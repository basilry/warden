import { renderPolicyReview, reviewPlannedToolCalls } from "../policy.ts";
import type { Agent, PolicyReviewReport, ToolCallPlan } from "../types.ts";
import { createHandoff } from "./base.ts";

export type PolicyReviewerInput = {
  calls: ToolCallPlan[];
  availableCapabilities?: string[];
};

export function createPolicyReviewerAgent(): Agent<PolicyReviewerInput, PolicyReviewReport> {
  return {
    role: "policy_reviewer",
    async run(task, context, input) {
      const report = reviewPlannedToolCalls(input.calls, {
        runId: context.runId,
        taskId: task.id,
        role: "policy_reviewer",
        availableCapabilities: input.availableCapabilities
      });

      for (const [index, call] of input.calls.entries()) {
        const decision = report.decisions[index];
        context.trace.record({
          phase: "policy_decision",
          actor: "policy",
          taskId: task.id,
          ref: call.toolName,
          summary: `${decision.decision} ${decision.risk} for planned ${call.toolName}: ${decision.reason}`,
          payload: { call, decision }
        });
      }

      const status = report.status === "allow" ? "succeeded" : report.status === "approval_required" ? "blocked" : "failed";
      return {
        status,
        output: report,
        summary: renderPolicyReview(report),
        handoffs:
          status === "succeeded"
            ? [createHandoff("policy_reviewer", "ach_analyst", task.id, ["policy-review"], "Planned tool calls passed policy review.")]
            : [],
        failureClass: report.status === "blocked" ? "policy_review_blocked" : undefined
      };
    }
  };
}

export async function runPolicyReviewer(
  task: Parameters<ReturnType<typeof createPolicyReviewerAgent>["run"]>[0],
  context: Parameters<ReturnType<typeof createPolicyReviewerAgent>["run"]>[1],
  input: PolicyReviewerInput
) {
  return createPolicyReviewerAgent().run(task, context, input);
}

