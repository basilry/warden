import type { ApprovalRequest } from "../agent/approval.ts";
import { runSourceVetReviewer } from "../agent/agents/sourcevet-reviewer.ts";
import { nowIso } from "../agent/ids.ts";
import type { OsintSearchMcpInvoker } from "../agent/mcp/osint-client.ts";
import { runTeamWorkflow } from "../agent/team-runner.ts";
import type { KnowledgeUnit, TeamRunResult } from "../agent/types.ts";
import type { OsintFetchLike } from "../connectors/osint/http-client.ts";
import type { OsintProviderTelemetry, OsintProviderWarning } from "../connectors/osint/search-types.ts";
import type { OsintBlockedReason, OsintConnectorConfig, OsintFetchResult, OsintStoredArtifact } from "../connectors/osint/types.ts";
import { composeDeterministicAnswer } from "./answer.ts";
import { calculateSurvivorDelta, renderSurvivorDelta } from "./answer-delta.ts";
import { EXTERNAL_OSINT_FETCH_TOOL, fetchApprovedExternalOsint } from "./external-fetch.ts";
import { runApprovedLiveOsintFetch } from "./live-osint-fetch.ts";
import { promoteSourceVettedUnitsToBundles } from "./resume-evidence.ts";
import type { RuntimeResumeResult, RuntimeRun } from "./types.ts";

export type ResumeApprovedExternalFetchOptions = {
  osint?: OsintConnectorConfig;
  osintFetchImpl?: OsintFetchLike;
  osintSearchInvoker?: OsintSearchMcpInvoker;
};

type ResumeFetchResult = {
  mode: RuntimeResumeResult["fetchMode"];
  units: KnowledgeUnit[];
  artifacts?: OsintStoredArtifact[];
  warnings?: string[];
  providerWarnings?: OsintProviderWarning[];
  providerTelemetry?: OsintProviderTelemetry[];
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
    providerWarnings: fetchResult.providerWarnings,
    providerTelemetry: fetchResult.providerTelemetry,
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
  if (options.osint?.liveOptIn && options.osintSearchInvoker) {
    const mcp = await runApprovedOsintMcpSearch(run, approval, options);
    if (mcp.status !== "succeeded") {
      throw new Error(`Live OSINT fetch blocked (${mcp.blockedReason ?? "unknown"}): ${mcp.warnings.join(" ")}`);
    }
    return {
      mode: "live-osint",
      units: mcp.units,
      artifacts: mcp.artifacts,
      warnings: mcp.warnings,
      providerWarnings: mcp.providerWarnings,
      providerTelemetry: mcp.providerTelemetry
    };
  }

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
      warnings: live.warnings,
      providerWarnings: live.providerWarnings,
      providerTelemetry: live.providerTelemetry
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

async function runApprovedOsintMcpSearch(
  run: RuntimeRun,
  approval: ApprovalRequest,
  options: ResumeApprovedExternalFetchOptions
): Promise<OsintFetchResult> {
  const approvalWarning = validateMcpSearchApproval(approval, run.id);
  if (approvalWarning) return blockedMcpSearch("approval_required", approvalWarning);

  const result = await options.osintSearchInvoker!({
    query: run.objective,
    runId: run.id,
    approvalId: approval.id,
    maxResults: options.osint?.maxResults
  });
  if (result.status !== "succeeded" || !result.output) {
    return blockedMcpSearch("config_invalid", `OSINT MCP search failed: ${result.error ?? result.status}.`);
  }

  const searchResult = result.output.result;
  return {
    status: searchResult.status,
    blockedReason: searchResult.blockedReason as OsintBlockedReason | undefined,
    units: searchResult.units,
    artifacts: searchResult.artifacts,
    sourceVetRequired: true,
    promoteToAch: false,
    providerWarnings: searchResult.providerWarnings,
    providerTelemetry: searchResult.providerTelemetry,
    warnings:
      searchResult.status === "succeeded"
        ? [
            ...searchResult.warnings,
            "OSINT MCP search result is unvetted and must pass SourceVet before ACH promotion."
          ]
        : searchResult.warnings
  };
}

function validateMcpSearchApproval(approval: ApprovalRequest, runId: string): string | undefined {
  if (approval.status !== "approved") {
    return `Approval ${approval.id} is ${approval.status}.`;
  }
  if (approval.runId !== runId) {
    return `Approval ${approval.id} belongs to run ${approval.runId}.`;
  }
  if (approval.action.name !== EXTERNAL_OSINT_FETCH_TOOL || approval.decision.risk !== "EXTERNAL") {
    return `Approval ${approval.id} is not valid for ${EXTERNAL_OSINT_FETCH_TOOL}.`;
  }
  return undefined;
}

function blockedMcpSearch(blockedReason: OsintBlockedReason, warning: string): OsintFetchResult {
  return {
    status: "blocked",
    blockedReason,
    units: [],
    artifacts: [],
    sourceVetRequired: true,
    promoteToAch: false,
    warnings: [warning]
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
