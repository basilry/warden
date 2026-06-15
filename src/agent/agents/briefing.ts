import { createAuditBrief } from "../brief.ts";
import type { SourceReview } from "../sourcevet-types.ts";
import type { AchAnalysisResult, Agent, AuditBrief, PolicyReviewReport, VerificationReport } from "../types.ts";

export type BriefingInput = {
  ach: AchAnalysisResult;
  verification: VerificationReport;
  sourceReview?: SourceReview;
  policyReview?: PolicyReviewReport;
};

export function createBriefingAgent(): Agent<BriefingInput, AuditBrief> {
  return {
    role: "briefing",
    async run(task, context, input) {
      if (input.verification.status !== "pass") {
        return {
          status: "blocked",
          summary: "Briefing blocked because verification did not pass.",
          errors: ["verification_not_passed"],
          failureClass: "verification_failed"
        };
      }

      const brief = createAuditBrief({
        ach: input.ach,
        verification: input.verification,
        traceSummary: context.trace.summarize(),
        sourceReview: input.sourceReview,
        policyReview: input.policyReview
      });

      context.trace.record({
        phase: "brief_created",
        actor: "briefing",
        taskId: task.id,
        summary: "Audit brief created after verification pass.",
        payload: brief
      });

      return {
        status: "succeeded",
        output: brief,
        summary: `Audit brief created for ${input.ach.survivors.length} survivor hypothesis set(s).`
      };
    }
  };
}
