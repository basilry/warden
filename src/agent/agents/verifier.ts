import { createVerificationReport } from "../verifiers.ts";
import type { SourceReview } from "../sourcevet-types.ts";
import type { AchAnalysisResult, Agent, VerificationReport } from "../types.ts";
import { createHandoff } from "./base.ts";

export type VerifierInput = {
  ach?: AchAnalysisResult;
  sourceReview?: SourceReview;
};

export function createVerificationAgent(): Agent<VerifierInput, VerificationReport> {
  return {
    role: "verifier",
    async run(task, context, input) {
      const report = createVerificationReport({
        ach: input.ach,
        sourceReview: input.sourceReview,
        trace: context.trace.getEvents()
      });

      context.trace.record({
        phase: "verification",
        actor: "verifier",
        taskId: task.id,
        summary: `Verification ${report.status}.`,
        payload: report
      });

      return {
        status: report.status === "pass" ? "succeeded" : "failed",
        output: report,
        summary: `Verification ${report.status} with ${report.checks.length} checks.`,
        failureClass: report.checks.find((check) => check.status === "fail")?.failureClass,
        handoffs:
          report.status === "pass"
            ? [createHandoff("verifier", "briefing", task.id, ["verification-report"], "Verification passed; briefing may proceed.")]
            : []
      };
    }
  };
}
