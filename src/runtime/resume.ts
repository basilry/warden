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
import { buildRuntimeAnalysisProducts } from "./analysis-products.ts";
import { calculateSurvivorDelta, renderSurvivorDelta } from "./answer-delta.ts";
import { EXTERNAL_OSINT_FETCH_TOOL, fetchApprovedExternalOsint } from "./external-fetch.ts";
import { formatSourceKindKo, translateDisplayKo } from "./korean-format.ts";
import { runApprovedLiveOsintFetch } from "./live-osint-fetch.ts";
import { promoteSourceVettedUnitsToBundles } from "./resume-evidence.ts";
import { composeSecurityReport } from "./report-composer.ts";
import { filterRelevantKnowledgeUnits } from "./source-relevance.ts";
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
  if (fetchedUnits.length === 0) {
    const resumeResult: RuntimeResumeResult = {
      approvalId: approval.id,
      fetchMode: fetchResult.mode,
      fetchedUnits,
      promotedBundles: [],
      rejectedUnits: [],
      osintArtifacts: fetchResult.artifacts,
      fetchWarnings: uniqueNonEmpty([
        ...(fetchResult.warnings ?? []),
        "승인 후 외부 OSINT 수집을 시도했지만 반영 가능한 자료가 없었습니다. 기존 분석 결과는 유지됩니다."
      ]),
      providerWarnings: fetchResult.providerWarnings,
      providerTelemetry: fetchResult.providerTelemetry,
      achBefore: run.outputs.ach,
      achAfter: run.outputs.ach,
      survivorDelta: calculateSurvivorDelta(run.outputs.ach, run.outputs.ach)
    };
    return mergeResumeResultIntoRun(run, [], undefined, resumeResult);
  }
  const sourceVet = await runSourceVetReviewer({
    units: fetchedUnits,
    minIndependentSources: 1
  });
  if (sourceVet.result.status !== "succeeded" || !sourceVet.review) {
    throw new Error(`SourceVet resume review failed: ${sourceVet.result.summary}`);
  }

  const relevance = filterRelevantKnowledgeUnits(fetchedUnits, {
    objective: run.objective,
    investigationPlan: run.outputs.investigationPlan
  });
  const promotion = promoteSourceVettedUnitsToBundles(relevance.accepted, sourceVet.review, run.outputs.ach?.caseRecord, {
    investigationPlan: run.outputs.investigationPlan
  });
  const rejectedUnits = uniqueNonEmpty([...promotion.rejectedUnits, ...relevance.rejected.map((unit) => unit.id)]);

  if (promotion.promotedBundles.length === 0) {
    const resumeResult: RuntimeResumeResult = {
      approvalId: approval.id,
      fetchMode: fetchResult.mode,
      fetchedUnits,
      promotedBundles: [],
      rejectedUnits,
      osintArtifacts: fetchResult.artifacts,
      fetchWarnings: uniqueNonEmpty([...(fetchResult.warnings ?? []), ...relevance.warnings]),
      providerWarnings: fetchResult.providerWarnings,
      providerTelemetry: fetchResult.providerTelemetry,
      sourceReview: sourceVet.review,
      achBefore: run.outputs.ach,
      achAfter: run.outputs.ach,
      survivorDelta: calculateSurvivorDelta(run.outputs.ach, run.outputs.ach)
    };
    return mergeResumeResultIntoRun(run, [], undefined, resumeResult);
  }

  const rerun = await runTeamWorkflow(run.objective, {
    withSupervisor: false,
    withBriefing: false,
    withSourceVet: false,
    fixtureVariant: "normal",
    investigationPlan: run.outputs.investigationPlan,
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
    rejectedUnits,
    osintArtifacts: fetchResult.artifacts,
    fetchWarnings: uniqueNonEmpty([...(fetchResult.warnings ?? []), ...relevance.warnings]),
    providerWarnings: fetchResult.providerWarnings,
    providerTelemetry: fetchResult.providerTelemetry,
    sourceReview: sourceVet.review,
    achBefore: run.outputs.ach,
    achAfter: rerun.outputs.ach,
    survivorDelta: calculateSurvivorDelta(run.outputs.ach, rerun.outputs.ach)
  };
  return mergeResumeResultIntoRun(run, promotion.promotedUnits, rerun, resumeResult);
}

async function fetchApprovedResumeEvidence(
  run: RuntimeRun,
  approval: ApprovalRequest,
  options: ResumeApprovedExternalFetchOptions
): Promise<ResumeFetchResult> {
  if (options.osint?.liveOptIn && options.osintSearchInvoker) {
    const mcp = await runApprovedOsintMcpSearch(run, approval, options);
    if (mcp.status !== "succeeded") {
      if (isRecoverableOsintBlock(mcp.blockedReason)) {
        return {
          mode: "live-osint",
          units: [],
          artifacts: mcp.artifacts,
          warnings: mcp.warnings,
          providerWarnings: mcp.providerWarnings,
          providerTelemetry: mcp.providerTelemetry
        };
      }
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
    const queries = buildResumeOsintQueries(run);
    const live = await runApprovedLiveOsintFetch({
      query: queries[0] ?? run.objective,
      queries,
      approval,
      runId: run.id,
      config: options.osint,
      fetchImpl: options.osintFetchImpl
    });
    if (live.status !== "succeeded") {
      if (isRecoverableOsintBlock(live.blockedReason)) {
        return {
          mode: "live-osint",
          units: [],
          artifacts: live.artifacts,
          warnings: live.warnings,
          providerWarnings: live.providerWarnings,
          providerTelemetry: live.providerTelemetry
        };
      }
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

function isRecoverableOsintBlock(reason: OsintBlockedReason | undefined): boolean {
  return reason === "no_results" || reason === "timeout" || reason === "http_error";
}

async function runApprovedOsintMcpSearch(
  run: RuntimeRun,
  approval: ApprovalRequest,
  options: ResumeApprovedExternalFetchOptions
): Promise<OsintFetchResult> {
  const approvalWarning = validateMcpSearchApproval(approval, run.id);
  if (approvalWarning) return blockedMcpSearch("approval_required", approvalWarning);

  const result = await options.osintSearchInvoker!({
    query: buildResumeOsintQueries(run).join(" | "),
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

function buildResumeOsintQueries(run: RuntimeRun): string[] {
  const planQueries = run.outputs.investigationPlan?.searchPlan.map((step) => step.query) ?? [];
  return uniqueNonEmpty([
    run.objective,
    ...buildObjectiveSpecificQueries(run.objective),
    ...planQueries
  ]).slice(0, 4);
}

function buildObjectiveSpecificQueries(objective: string): string[] {
  const normalized = objective.toLowerCase();
  const queries: string[] = [];
  if (objective.includes("친중") || normalized.includes("pro-china") || normalized.includes("pro china")) {
    queries.push("South Korea pro-China policy United States response");
    queries.push("US reaction South Korea China alignment");
    queries.push("한국 친중 행위 미국 반응");
  }
  if ((objective.includes("미국") || normalized.includes("united states") || normalized.includes(" u.s.")) && objective.includes("반응")) {
    queries.push(`${objective} 미국 정부 반응 공식 발언`);
    queries.push(`${objective} US State Department response`);
  }
  if (objective.includes("공급망") || normalized.includes("supply chain")) {
    queries.push(`${objective} supply chain risk policy response`);
  }
  return queries;
}


function mergeResumeResultIntoRun(
  run: RuntimeRun,
  fetchedUnits: KnowledgeUnit[],
  rerun: TeamRunResult | undefined,
  resumeResult: RuntimeResumeResult
): RuntimeRun {
  const completedAt = nowIso();
  const fetchedEvidence = [...(run.outputs.fetchedEvidence ?? []), ...fetchedUnits];
  const preservedTeamResult = buildPreservedTeamResult(run, resumeResult);
  const answerTeamResult: TeamRunResult | undefined = rerun
    ? {
        ...rerun,
        outputs: {
          ...rerun.outputs,
          sourceReview: resumeResult.sourceReview
        }
      }
    : preservedTeamResult;
  const analysisProducts = buildRuntimeAnalysisProducts({
    objective: run.objective,
    investigationPlan: run.outputs.investigationPlan,
    teamResult: answerTeamResult,
    fetchedEvidence,
    existing: {
      domainExpansion: run.outputs.domainExpansion,
      ragContext: run.outputs.ragContext,
      claimGraph: run.outputs.claimGraph,
      evidenceLedger: run.outputs.evidenceLedger,
      forecast: run.outputs.forecast
    }
  });
  const answerContext = {
    objective: run.objective,
    runStatus: "succeeded",
    teamResult: answerTeamResult,
    approvals: run.approvals,
    modelResponses: run.modelResponses,
    domainGrounding: run.outputs.domainGrounding,
    domainExpansion: analysisProducts.domainExpansion,
    ragContext: analysisProducts.ragContext,
    claimGraph: analysisProducts.claimGraph,
    evidenceLedger: analysisProducts.evidenceLedger,
    forecast: analysisProducts.forecast,
    investigationPlan: run.outputs.investigationPlan,
    fetchedEvidence
  } as const;
  const answer = composeDeterministicAnswer(answerContext);
  const finalAnswer = {
    ...answer,
    keyFindings: [
      ...answer.keyFindings,
      renderSurvivorDelta(resumeResult.survivorDelta),
      `승인 후 수집 모드: ${formatSourceKindKo(resumeResult.fetchMode)}.`,
      `SourceVet 재개 검토: 상태=${formatSourceReviewStatusKo(resumeResult.sourceReview?.status)}, 플래그=${resumeResult.sourceReview?.flags.length ?? 0}.`
    ],
    uncertainty: [
      ...answer.uncertainty,
      ...(resumeResult.fetchWarnings ?? []).map(translateDisplayKo),
      "승인 후 근거 판정 매핑은 초기 규칙 기반이며 분석가가 확정한 매핑은 아닙니다."
    ],
    authorityRefs: [
      ...answer.authorityRefs,
      `재개승인=${resumeResult.approvalId}`,
      `재개수집모드=${formatSourceKindKo(resumeResult.fetchMode)}`,
      `재개승격근거=${resumeResult.promotedBundles.length}`,
      `재개보류근거=${resumeResult.rejectedUnits.length}`,
      ...(resumeResult.osintArtifacts?.length ? [`재개OSINT아티팩트=${resumeResult.osintArtifacts.length}`] : [])
    ]
  };
  return {
    ...run,
    status: "succeeded",
    completedAt,
    updatedAt: completedAt,
    outputs: {
      ...run.outputs,
      teamRunId: rerun?.run.id ?? run.outputs.teamRunId,
      teamStatus: rerun?.run.status ?? run.outputs.teamStatus,
      survivors: rerun?.outputs.ach?.survivors ?? run.outputs.survivors,
      traceEvents: rerun?.trace.length ?? run.outputs.traceEvents,
      fetchedEvidence,
      domainExpansion: analysisProducts.domainExpansion,
      ragContext: analysisProducts.ragContext,
      claimGraph: analysisProducts.claimGraph,
      evidenceLedger: analysisProducts.evidenceLedger,
      forecast: analysisProducts.forecast,
      caseFrame: rerun?.outputs.caseFrame ?? run.outputs.caseFrame,
      investigationPlan: run.outputs.investigationPlan,
      knowledgeUnits: rerun?.outputs.knowledgeUnits ?? run.outputs.knowledgeUnits,
      evidenceBundles: rerun?.outputs.evidenceBundles ?? run.outputs.evidenceBundles,
      ach: rerun?.outputs.ach ?? run.outputs.ach,
      sourceReview: resumeResult.sourceReview,
      resumeResult,
      answer: finalAnswer,
      securityReport: composeSecurityReport(answerContext, finalAnswer)
    },
    error: undefined
  };
}

function buildPreservedTeamResult(run: RuntimeRun, resumeResult: RuntimeResumeResult): TeamRunResult | undefined {
  const hasTeamOutputs = Boolean(
    run.outputs.ach ||
      run.outputs.caseFrame ||
      run.outputs.knowledgeUnits?.length ||
      run.outputs.evidenceBundles?.length ||
      run.outputs.sourceReview
  );
  if (!hasTeamOutputs) return undefined;

  const teamRunId = run.outputs.teamRunId ?? run.id;
  return {
    run: {
      id: teamRunId,
      objective: run.objective,
      status: run.outputs.teamStatus === "failed" ? "failed" : "succeeded",
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      tasks: [],
      handoffs: []
    },
    trace: [],
    traceSummary: {
      runId: teamRunId,
      eventCount: run.outputs.traceEvents ?? 0,
      phases: {},
      policyDecisions: {},
      toolCalls: [],
      failures: []
    },
    outputs: {
      investigationPlan: run.outputs.investigationPlan,
      caseFrame: run.outputs.caseFrame,
      knowledgeUnits: run.outputs.knowledgeUnits,
      evidenceBundles: run.outputs.evidenceBundles,
      sourceReview: resumeResult.sourceReview ?? run.outputs.sourceReview,
      ach: run.outputs.ach
    }
  };
}

function formatSourceReviewStatusKo(status: string | undefined): string {
  if (status === "pass") return "통과";
  if (status === "warn") return "주의";
  if (status === "fail") return "실패";
  return status ? translateDisplayKo(status) : "알 수 없음";
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
