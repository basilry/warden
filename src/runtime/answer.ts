import type { ApprovalRequest } from "../agent/approval.ts";
import {
  createModelRequest,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse
} from "../agent/model-adapter.ts";
import type { ClaimGraph } from "../agent/claim-graph/index.ts";
import type { EvidenceLedger } from "../agent/evidence-ledger.ts";
import type { Evidence, KnowledgeUnit, TeamRunResult, VerificationReport } from "../agent/types.ts";
import type { LocalRagRetrievalResult } from "../connectors/rag/types.ts";
import type { DomainQueryExpansion } from "../domain/index.ts";
import type { RuntimeForecastProducts } from "./analysis-products.ts";
import { formatEvidenceDisplay } from "./evidence-display.ts";
import type { InvestigationPlan } from "./investigation-plan-schema.ts";
import {
  formatConfidenceKo,
  formatDomainKo,
  formatHorizonKo,
  formatHypothesisKo,
  formatPlanSourceKo,
  formatRiskKo,
  formatScenarioKo,
  translateDisplayKo
} from "./korean-format.ts";
import type { RuntimeDomainGrounding, RuntimeRunStatus } from "./types.ts";

export type RuntimeAnswerMode = "deterministic" | "assisted";

export type RuntimeAnswer = {
  mode: RuntimeAnswerMode;
  title: string;
  directAnswer: string;
  keyFindings: string[];
  evidenceUsed: string[];
  uncertainty: string[];
  blockedActions: string[];
  nextSteps: string[];
  authorityRefs: string[];
  warnings: string[];
};

export type RuntimeAnswerDraft = {
  title?: string;
  directAnswer?: string;
  nextSteps?: string[];
};

export type AnswerValidationReport = {
  status: "pass" | "warn";
  warnings: string[];
};

export type AnswerContext = {
  objective: string;
  runStatus: RuntimeRunStatus;
  teamResult?: TeamRunResult;
  approvals: ApprovalRequest[];
  modelResponses: ModelResponse[];
  domainGrounding?: RuntimeDomainGrounding;
  domainExpansion?: DomainQueryExpansion;
  ragContext?: LocalRagRetrievalResult;
  claimGraph?: ClaimGraph;
  evidenceLedger?: EvidenceLedger;
  forecast?: RuntimeForecastProducts;
  investigationPlan?: InvestigationPlan;
  fetchedEvidence?: KnowledgeUnit[];
};

export function composeDeterministicAnswer(context: AnswerContext): RuntimeAnswer {
  const ach = context.teamResult?.outputs.ach;
  const verification = context.teamResult?.outputs.verification;
  const sourceReview = context.teamResult?.outputs.sourceReview;
  const pendingApprovals = context.approvals.filter((approval) => approval.status === "pending");
  const survivors = ach?.survivors ?? [];
  const evidence = ach?.caseRecord.evidence ?? [];
  const fetchedEvidence = context.fetchedEvidence ?? [];
  const domainEvidence = context.domainGrounding?.evidence ?? [];

  const keyFindings =
    ach && survivors.length > 0
      ? [
          ...ach.ranked
            .filter((score) => score.status === "survivor")
            .map(
              (score) =>
                `${formatHypothesisKo(score.hypothesis)}: 현재 ACH 생존 가설입니다. 지지=${score.support}, 반박=${score.contradictions}.`
            ),
          ...buildInvestigationPlanFindings(context.investigationPlan),
          ...buildDomainFindings(context.domainGrounding),
          ...buildDomainExpansionFindings(context.domainExpansion),
          ...buildForecastFindings(context.forecast),
          ...buildClaimGraphFindings(context.claimGraph, context.evidenceLedger)
        ]
      : ["아직 검증된 생존 가설이 없습니다. 먼저 분석 팀 실행 결과가 필요합니다."];

  const uncertainty = [
    ...((verification?.residualRisk ?? []).length > 0
      ? (verification?.residualRisk ?? []).map(translateDisplayKo)
      : ["현재 답변은 WARDEN 로컬 분석 결과에 제한됩니다."]),
    ...(sourceReview?.flags.map((flag) => `SourceVet ${flag.severity}: ${flag.summary}`) ?? []),
    ...(context.domainGrounding?.limits.map((limit) => `도메인 프로파일 한계: ${translateDisplayKo(limit)}`) ?? []),
    ...(context.domainGrounding?.warnings.map((warning) => `도메인 근거 주의: ${translateDisplayKo(warning)}`) ?? []),
    ...(context.domainExpansion?.warnings.map((warning) => `온톨로지 확장 주의: ${translateDisplayKo(warning)}`) ?? []),
    ...(context.ragContext?.warnings.map((warning) => `로컬 RAG 주의: ${translateDisplayKo(warning)}`) ?? []),
    ...(context.forecast?.warnings.map((warning) => `예측 주의: ${translateDisplayKo(warning)}`) ?? []),
    ...(context.investigationPlan
      ? [
          `분석계획은 ${formatPlanSourceKo(context.investigationPlan.source)}에서 생성되었고 현재 자동 점수화는 초기 규칙입니다.`
        ]
      : []),
    ...(pendingApprovals.length > 0 ? ["외부 OSINT 수집은 승인 전이라 답변 근거에 반영되지 않았습니다."] : []),
    ...(fetchedEvidence.length > 0
      ? ["승인 후 외부 수집 근거는 현재 런타임 재평가에 반영되었습니다. 실제 웹 OSINT connector 품질은 SourceVet 결과와 함께 확인해야 합니다."]
      : [])
  ];

  return {
    mode: "deterministic",
    title: context.objective,
    directAnswer: buildDirectAnswer(
      context.objective,
      survivors,
      pendingApprovals.length,
      context.domainGrounding,
      context.investigationPlan
    ),
    keyFindings,
    evidenceUsed: buildEvidenceUsed(evidence, domainEvidence, fetchedEvidence, context.ragContext?.units ?? []),
    uncertainty: uniqueNonEmpty(uncertainty),
    blockedActions: pendingApprovals.map(
      (approval) => `${approval.action.name}: ${translateApprovalReasonKo(approval.reason)} (${formatRiskKo(approval.decision.risk)})`
    ),
    nextSteps: buildNextSteps(ach?.rfi, pendingApprovals),
    authorityRefs: buildAuthorityRefs(context),
    warnings: buildWarnings(context)
  };
}

export async function composeModelAssistedAnswer(
  context: AnswerContext,
  model: ModelAdapter
): Promise<{ answer: RuntimeAnswer; response?: ModelResponse<unknown> }> {
  const request = createAnswerDraftRequest(context);
  const response = await model.generate<unknown>(request);
  return {
    answer: composeModelAssistedAnswerFromResponse(context, response),
    response
  };
}

export function createAnswerDraftRequest(context: AnswerContext): ModelRequest {
  const deterministic = composeDeterministicAnswer(context);
  return createModelRequest({
    role: "briefing",
    responseFormat: "json",
    prompt: [
      "You are drafting a Korean user-facing answer for WARDEN.",
      "You may improve wording only. Do not change ACH survivors, policy status, approvals, evidence, or uncertainty.",
      "Return only JSON with optional fields: title, directAnswer, nextSteps.",
      "Do not claim external OSINT was used if approval is pending.",
      "",
      `Objective: ${context.objective}`,
      `Investigation domain: ${context.investigationPlan?.domain ?? "unknown"}`,
      `Deterministic direct answer: ${deterministic.directAnswer}`,
      `Key findings: ${deterministic.keyFindings.join(" | ")}`,
      `Uncertainty: ${deterministic.uncertainty.join(" | ")}`,
      `Blocked actions: ${deterministic.blockedActions.join(" | ") || "none"}`,
      `Forecast: ${
        context.forecast
          ? `${formatPercent(context.forecast.estimate.probability)} ${formatRange(context.forecast.estimate.probabilityRange)}`
          : "none"
      }`
    ].join("\n"),
    context: buildAnswerDraftContext(context, deterministic)
  });
}

export function composeModelAssistedAnswerFromResponse(
  context: AnswerContext,
  response: ModelResponse<unknown>
): RuntimeAnswer {
  const deterministic = composeDeterministicAnswer(context);
  const draft = parseAnswerDraft(response.output);

  if (!draft) {
    return {
      ...deterministic,
      warnings: uniqueNonEmpty([
        ...deterministic.warnings,
        ...response.warnings,
        "모델 보조 답변 초안이 유효한 RuntimeAnswerDraft가 아니라 deterministic answer로 fallback했습니다."
      ])
    };
  }

  const candidate: RuntimeAnswer = {
    ...deterministic,
    mode: "assisted",
    title: draft.title?.trim() || deterministic.title,
    directAnswer: draft.directAnswer?.trim() || deterministic.directAnswer,
    nextSteps: uniqueNonEmpty([...(draft.nextSteps ?? []), ...deterministic.nextSteps]),
    warnings: uniqueNonEmpty([...deterministic.warnings, ...response.warnings])
  };
  const validation = validateAnswerAgainstAuthorities(candidate, context);

  if (validation.status === "warn") {
    return {
      ...candidate,
      directAnswer: validation.warnings.some((warning) => warning.includes("directAnswer"))
        ? deterministic.directAnswer
        : candidate.directAnswer,
      warnings: uniqueNonEmpty([...candidate.warnings, ...validation.warnings])
    };
  }

  return {
    ...candidate,
    warnings: uniqueNonEmpty([...candidate.warnings, ...validation.warnings])
  };
}

export function validateAnswerAgainstAuthorities(answer: RuntimeAnswer, context: AnswerContext): AnswerValidationReport {
  const warnings: string[] = [];
  const survivors = context.teamResult?.outputs.ach?.survivors ?? [];
  const pendingApprovals = context.approvals.filter((approval) => approval.status === "pending");
  const answerText = [
    answer.directAnswer,
    ...answer.keyFindings,
    ...answer.uncertainty,
    ...answer.blockedActions,
    ...answer.nextSteps
  ].join("\n");

  for (const survivor of survivors) {
    const translatedSurvivor = formatHypothesisKo(survivor);
    if (!answer.keyFindings.some((finding) => finding.includes(survivor) || finding.includes(translatedSurvivor))) {
      warnings.push(`authority violation: survivor "${survivor}" missing from keyFindings.`);
    }
  }

  for (const approval of pendingApprovals) {
    if (!answer.blockedActions.some((blocked) => blocked.includes(approval.action.name))) {
      warnings.push(`authority violation: pending approval "${approval.action.name}" missing from blockedActions.`);
    }
  }

  if (
    pendingApprovals.length > 0 &&
    /외부.*(반영했습니다|반영됨|반영했다|수집 완료|확인 완료)|승인 완료/.test(answer.directAnswer)
  ) {
    warnings.push("authority violation: directAnswer implies external evidence or approval completion before approval.");
  }

  if (/확정 결론|단정할 수 있습니다|단정한다/.test(answer.directAnswer)) {
    warnings.push("authority violation: directAnswer overstates certainty.");
  }

  if (context.teamResult?.outputs.sourceReview?.flags.length) {
    for (const flag of context.teamResult.outputs.sourceReview.flags) {
      if (!answerText.includes(flag.code) && !answerText.includes(flag.summary)) {
        warnings.push(`authority warning: SourceVet flag "${flag.code}" is not visible in the answer.`);
      }
    }
  }

  const verification = context.teamResult?.outputs.verification;
  for (const risk of verificationResidualRisk(verification)) {
    if (!answer.uncertainty.some((item) => item.includes(risk))) {
      warnings.push(`authority warning: residual risk missing from uncertainty: ${risk}`);
    }
  }

  return {
    status: warnings.length > 0 ? "warn" : "pass",
    warnings
  };
}

function buildAnswerDraftContext(context: AnswerContext, deterministic: RuntimeAnswer): unknown {
  return {
    objective: context.objective,
    runStatus: context.runStatus,
    deterministicAnswer: {
      directAnswer: deterministic.directAnswer,
      keyFindings: deterministic.keyFindings,
      uncertainty: deterministic.uncertainty,
      blockedActions: deterministic.blockedActions,
      nextSteps: deterministic.nextSteps,
      authorityRefs: deterministic.authorityRefs
    },
    domainExpansion: context.domainExpansion
      ? {
          scenarios: context.domainExpansion.scenarios.map((item) => item.id),
          actors: context.domainExpansion.actors.map((item) => item.id),
          signals: context.domainExpansion.signals.map((item) => item.id),
          warnings: context.domainExpansion.warnings
        }
      : undefined,
    ragContext: context.ragContext
      ? {
          unitCount: context.ragContext.units.length,
          warnings: context.ragContext.warnings
        }
      : undefined,
    forecast: context.forecast
      ? {
          probability: context.forecast.estimate.probability,
          probabilityRange: context.forecast.estimate.probabilityRange,
          confidenceBand: context.forecast.estimate.confidenceBand,
          scenarios: context.forecast.scenarioSet.scenarios.map((scenario) => ({
            id: scenario.id,
            label: scenario.label,
            probability: scenario.probability
          }))
        }
      : undefined
  };
}

function parseAnswerDraft(output: unknown): RuntimeAnswerDraft | undefined {
  const parsed = typeof output === "string" ? parseJsonObject(output) : output;
  if (!isRecord(parsed)) return undefined;
  const directAnswer = typeof parsed.directAnswer === "string" ? parsed.directAnswer : undefined;
  const title = typeof parsed.title === "string" ? parsed.title : undefined;
  const nextSteps = Array.isArray(parsed.nextSteps)
    ? parsed.nextSteps.filter((item): item is string => typeof item === "string")
    : undefined;
  if (!directAnswer && !title && !nextSteps?.length) return undefined;
  return { title, directAnswer, nextSteps };
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function verificationResidualRisk(verification: VerificationReport | undefined): string[] {
  return verification?.residualRisk ?? [];
}

function buildDirectAnswer(
  objective: string,
  survivors: string[],
  pendingApprovalCount: number,
  grounding?: RuntimeDomainGrounding,
  investigationPlan?: InvestigationPlan
): string {
  if (survivors.length === 0) {
    return [
      `질문 "${objective}"에 대해 아직 확정 가능한 WARDEN 분석 결과가 없습니다.`,
      "분석 팀 실행, ACH 평가, 검증 결과가 준비되어야 답변을 만들 수 있습니다."
    ].join(" ");
  }

  const survivorText = survivors.map(formatHypothesisKo).join(", ");
  const domainLabel = grounding ? formatDomainKo(grounding.domain) : "";
  const domainText = grounding
    ? `P10 도메인 근거는 ${domainLabel}${directionParticle(domainLabel)} 분류되었고 신뢰도=${grounding.confidence.toFixed(2)}입니다.`
    : "";
  const approvalText =
    pendingApprovalCount > 0
      ? "다만 외부 정보 수집은 승인 대기 상태라, 현재 답변은 로컬/고정 데이터 기반 근거에 한정됩니다."
      : "현재 승인 대기 중인 외부 수집은 없습니다.";
  const investigationText = investigationPlan
    ? `분석계획은 ${formatDomainKo(investigationPlan.domain)} 도메인/${formatScenarioKo(investigationPlan.classification.scenario)} 시나리오로 분류했고, ${investigationPlan.hypotheses.length}개 경쟁 가설과 ${investigationPlan.searchPlan.length}개 검색계획을 잡았습니다.`
    : "";

  return [
    `질문 "${objective}"에 대해 WARDEN의 현재 통제 분석에서는 ${survivorText} 가설이 생존했습니다.`,
    investigationText,
    domainText,
    "이는 확정 결론이 아니라 ACH, 정책 게이트, 검증자가 허용한 범위의 중간 분석입니다.",
    approvalText
  ]
    .filter(Boolean)
    .join(" ");
}

function buildNextSteps(rfi: string | undefined, pendingApprovals: ApprovalRequest[]): string[] {
  return uniqueNonEmpty([
    rfi ? translateDisplayKo(rfi) : undefined,
    ...pendingApprovals.map((approval) => `${approval.action.name} 승인 여부를 결정한 뒤 같은 run을 재개해야 합니다.`),
    "추가 근거가 들어오면 SourceVet과 ACH를 다시 실행해 생존 가설을 재평가합니다."
  ]);
}

function directionParticle(value: string): "로" | "으로" {
  const last = [...value].reverse().find((char) => /[가-힣]/.test(char));
  if (!last) return "로";
  const code = (last.codePointAt(0) ?? 0) - 0xac00;
  if (code < 0 || code > 11_171) return "로";
  const finalConsonant = code % 28;
  return finalConsonant === 0 || finalConsonant === 8 ? "로" : "으로";
}

function buildAuthorityRefs(context: AnswerContext): string[] {
  const team = context.teamResult;
  return uniqueNonEmpty([
    team ? `팀실행=${team.run.id}` : undefined,
    team?.outputs.ach ? `ACH사례=${team.outputs.ach.caseId}` : undefined,
    team?.outputs.verification ? `검증=${formatVerificationStatusKo(team.outputs.verification.status)}` : undefined,
    team ? `추적이벤트=${team.trace.length}` : undefined,
    context.domainGrounding ? `도메인=${formatDomainKo(context.domainGrounding.domain)}` : undefined,
    context.domainGrounding ? `도메인근거=${context.domainGrounding.evidence.length}` : undefined,
    context.domainExpansion ? `온톨로지시나리오=${context.domainExpansion.scenarios.length}` : undefined,
    context.ragContext ? `RAG근거=${context.ragContext.units.length}` : undefined,
    context.claimGraph ? `근거그래프=${context.claimGraph.id}` : undefined,
    context.claimGraph ? `정규주장=${context.claimGraph.canonicalClaimCount}` : undefined,
    context.evidenceLedger ? `근거원장=${context.evidenceLedger.id}` : undefined,
    context.forecast ? `예측확률=${formatPercent(context.forecast.estimate.probability)}` : undefined,
    context.forecast ? `예측범위=${formatRange(context.forecast.estimate.probabilityRange)}` : undefined,
    context.investigationPlan ? `분석도메인=${formatDomainKo(context.investigationPlan.domain)}` : undefined,
    context.investigationPlan ? `분석가설=${context.investigationPlan.hypotheses.length}` : undefined,
    context.investigationPlan ? `검색계획=${context.investigationPlan.searchPlan.length}` : undefined,
    context.fetchedEvidence?.length ? `승인외부근거=${context.fetchedEvidence.length}` : undefined,
    context.modelResponses.length > 0 ? `모델제안=${context.modelResponses.length}` : undefined
  ]);
}

function buildWarnings(context: AnswerContext): string[] {
  const warnings = context.modelResponses.flatMap((response) => response.warnings.map(translateDisplayKo));
  if (!context.teamResult?.outputs.sourceReview) {
    warnings.push("SourceVet은 현재 런타임 기본 경로에서 생략되었습니다. 외부/문서 근거가 붙으면 다시 켜야 합니다.");
  }
  if (!context.teamResult?.outputs.brief) {
    warnings.push("Briefing agent는 CLI 런타임에서 생략되었습니다. 사용자 답변은 RuntimeAnswer composer가 생성했습니다.");
  }
  return uniqueNonEmpty(warnings);
}

function buildDomainFindings(grounding: RuntimeDomainGrounding | undefined): string[] {
  if (!grounding) return [];
  return [
    `도메인 근거: ${formatDomainKo(grounding.domain)} 질문으로 분류되었고, 로컬 프로파일 근거 ${grounding.evidence.length}건이 검색되었습니다.`
  ];
}

function buildInvestigationPlanFindings(plan: InvestigationPlan | undefined): string[] {
  if (!plan) return [];
  return [
    `분석계획: ${formatDomainKo(plan.domain)} 도메인, 시나리오=${formatScenarioKo(plan.classification.scenario)}, 매칭 신호=${plan.classification.matchedSignals.map(translateDisplayKo).join(", ") || "없음"}.`
  ];
}

function buildDomainExpansionFindings(expansion: DomainQueryExpansion | undefined): string[] {
  if (!expansion) return [];
  const scenarioIds = expansion.scenarios.map((item) => formatScenarioKo(item.id));
  const actorLabels = expansion.actors.map((item) => translateDisplayKo(item.label)).slice(0, 5);
  const signalLabels = expansion.signals.map((item) => translateDisplayKo(item.label)).slice(0, 5);
  return [
    `도메인 온톨로지: 시나리오=${scenarioIds.join(", ") || "없음"}, 액터=${actorLabels.join(", ") || "없음"}, 신호=${signalLabels.join(", ") || "없음"}.`
  ];
}

function buildForecastFindings(forecast: RuntimeForecastProducts | undefined): string[] {
  if (!forecast) return [];
  return [
    `예측: ${formatHorizonKo(forecast.horizon.label, forecast.horizon.months)} 기준 기준확률=${formatPercent(forecast.estimate.probability)}, 범위=${formatRange(forecast.estimate.probabilityRange)}, 신뢰도=${formatConfidenceKo(forecast.estimate.confidenceBand.label)}.`
  ];
}

function buildClaimGraphFindings(graph: ClaimGraph | undefined, ledger: EvidenceLedger | undefined): string[] {
  if (!graph) return [];
  return [
    `근거 그래프: 출처 단위=${graph.sourceUnitCount}, 정규화 주장=${graph.canonicalClaimCount}, 반박 관계=${graph.contradictionCount}, 근거 원장 항목=${ledger?.entries.length ?? 0}.`
  ];
}

function buildEvidenceUsed(
  achEvidence: Evidence[],
  domainEvidence: RuntimeDomainGrounding["evidence"],
  fetchedEvidence: KnowledgeUnit[],
  ragEvidence: KnowledgeUnit[]
): string[] {
  return formatEvidenceDisplay({
    achEvidence,
    domainEvidence,
    fetchedEvidence,
    ragEvidence
  });
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function translateApprovalReasonKo(reason: string | undefined): string {
  if (reason === "External calls are blocked until human approval.") {
    return "외부 호출은 사람의 승인이 있을 때까지 차단됩니다.";
  }
  return reason ?? "승인 사유가 기록되지 않았습니다.";
}

function formatVerificationStatusKo(status: string): string {
  if (status === "pass") return "통과";
  if (status === "warn") return "주의";
  if (status === "fail") return "실패";
  return translateDisplayKo(status);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10_000) / 100}%`;
}

function formatRange(range: { lower: number; upper: number }): string {
  return `${formatPercent(range.lower)}-${formatPercent(range.upper)}`;
}
