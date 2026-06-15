import type { ApprovalRequest } from "../agent/approval.ts";
import { runSourceVetReviewer } from "../agent/agents/sourcevet-reviewer.ts";
import { nowIso } from "../agent/ids.ts";
import { runTeamWorkflow } from "../agent/team-runner.ts";
import type { KnowledgeUnit, TeamRunResult } from "../agent/types.ts";
import type { OsintFetchLike } from "../connectors/osint/http-client.ts";
import type { OsintConnectorConfig, OsintStoredArtifact } from "../connectors/osint/types.ts";
import { composeDeterministicAnswer } from "./answer.ts";
import { calculateSurvivorDelta, renderSurvivorDelta } from "./answer-delta.ts";
import { fetchApprovedExternalOsint } from "./external-fetch.ts";
import { runApprovedLiveOsintFetch } from "./live-osint-fetch.ts";
import { promoteSourceVettedUnitsToBundles } from "./resume-evidence.ts";
import type { RuntimeResumeResult, RuntimeRun } from "./types.ts";

export type ResumeApprovedExternalFetchOptions = {
  osint?: OsintConnectorConfig;
  osintFetchImpl?: OsintFetchLike;
};

type ResumeFetchResult = {
  mode: RuntimeResumeResult["fetchMode"];
  units: KnowledgeUnit[];
  artifacts?: OsintStoredArtifact[];
  warnings?: string[];
};

export async function resumeApprovedExternalFetchRun(
  run: RuntimeRun,
  approval: ApprovalRequest,
  options: ResumeApprovedExternalFetchOptions = {}
): Promise<RuntimeRun> {
  const fetchResult = await fetchApprovedResumeEvidence(run, approval, options);
  const fetchedUnits = fetchResult.units;
  const sourceVet = await runSourceVetReviewer({
    units: fetchedUnits,
    minIndependentSources: 1
  });
  if (sourceVet.result.status !== "succeeded" || !sourceVet.review) {
    throw new Error(`SourceVet resume review failed: ${sourceVet.result.summary}`);
  }

  const promotion = promoteSourceVettedUnitsToBundles(fetchedUnits, sourceVet.review, run.outputs.ach?.caseRecord);
  const rerun = await runTeamWorkflow(run.objective, {
    withSupervisor: false,
    withBriefing: false,
    withSourceVet: false,
    fixtureVariant: "normal",
    extraKnowledgeUnits: promotion.promotedUnits,
    extraEvidenceBundles: promotion.promotedBundles
  });
  if (rerun.run.status !== "succeeded" || !rerun.outputs.ach) {
    throw new Error(`ACH resume rerun failed: ${rerun.run.status}`);
  }

  const resumeResult: RuntimeResumeResult = {
    approvalId: approval.id,
    fetchMode: fetchResult.mode,
    fetchedUnits,
    promotedBundles: promotion.promotedBundles,
    rejectedUnits: promotion.rejectedUnits,
    osintArtifacts: fetchResult.artifacts,
    fetchWarnings: fetchResult.warnings,
    sourceReview: sourceVet.review,
    achBefore: run.outputs.ach,
    achAfter: rerun.outputs.ach,
    survivorDelta: calculateSurvivorDelta(run.outputs.ach, rerun.outputs.ach)
  };
  return mergeResumeResultIntoRun(run, fetchedUnits, rerun, resumeResult);
}

async function fetchApprovedResumeEvidence(
  run: RuntimeRun,
  approval: ApprovalRequest,
  options: ResumeApprovedExternalFetchOptions
): Promise<ResumeFetchResult> {
  if (options.osint?.liveOptIn) {
    const live = await runApprovedLiveOsintFetch({
      query: run.objective,
      approval,
      runId: run.id,
      config: options.osint,
      fetchImpl: options.osintFetchImpl
    });
    if (live.status !== "succeeded") {
      throw new Error(`Live OSINT fetch blocked (${live.blockedReason ?? "unknown"}): ${live.warnings.join(" ")}`);
    }
    return {
      mode: "live-osint",
      units: live.units,
      artifacts: live.artifacts,
      warnings: live.warnings
    };
  }

  return {
    mode: "fixture",
    units: fetchApprovedExternalOsint({
      query: run.objective,
      approval,
      runId: run.id,
      extraTags: ["runtime-resume"]
    })
  };
}

function mergeResumeResultIntoRun(
  run: RuntimeRun,
  fetchedUnits: KnowledgeUnit[],
  rerun: TeamRunResult,
  resumeResult: RuntimeResumeResult
): RuntimeRun {
  const completedAt = nowIso();
  const fetchedEvidence = [...(run.outputs.fetchedEvidence ?? []), ...fetchedUnits];
  const answerTeamResult: TeamRunResult = {
    ...rerun,
    outputs: {
      ...rerun.outputs,
      sourceReview: resumeResult.sourceReview
    }
  };
  const answer = composeDeterministicAnswer({
    objective: run.objective,
    runStatus: "succeeded",
    teamResult: answerTeamResult,
    approvals: run.approvals,
    modelResponses: run.modelResponses,
    domainGrounding: run.outputs.domainGrounding,
    fetchedEvidence
  });
  return {
    ...run,
    status: "succeeded",
    completedAt,
    updatedAt: completedAt,
    outputs: {
      ...run.outputs,
      teamRunId: rerun.run.id,
      teamStatus: rerun.run.status,
      survivors: rerun.outputs.ach?.survivors,
      traceEvents: rerun.trace.length,
      fetchedEvidence,
      caseFrame: rerun.outputs.caseFrame,
      knowledgeUnits: rerun.outputs.knowledgeUnits,
      evidenceBundles: rerun.outputs.evidenceBundles,
      ach: rerun.outputs.ach,
      sourceReview: resumeResult.sourceReview,
      resumeResult,
      answer: {
        ...answer,
        keyFindings: [
          ...answer.keyFindings,
          renderSurvivorDelta(resumeResult.survivorDelta),
          `승인 후 fetch mode: ${resumeResult.fetchMode}.`,
          `SourceVet resume 검토: status=${resumeResult.sourceReview?.status ?? "unknown"}, flags=${resumeResult.sourceReview?.flags.length ?? 0}.`
        ],
        uncertainty: [
          ...answer.uncertainty,
          ...(resumeResult.fetchWarnings ?? []),
          "승인 후 evidence verdict mapping은 deterministic 초기 규칙이며 analyst-confirmed mapping이 아니다."
        ],
        authorityRefs: [
          ...answer.authorityRefs,
          `resumeApproval=${resumeResult.approvalId}`,
          `resumeFetchMode=${resumeResult.fetchMode}`,
          `resumePromotedEvidence=${resumeResult.promotedBundles.length}`,
          `resumeRejectedEvidence=${resumeResult.rejectedUnits.length}`,
          ...(resumeResult.osintArtifacts?.length ? [`resumeOsintArtifacts=${resumeResult.osintArtifacts.length}`] : [])
        ]
      }
    },
    error: undefined
  };
}
