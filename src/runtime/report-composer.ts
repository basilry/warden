import type { RuntimeAnswer, AnswerContext } from "./answer.ts";
import {
  formatConfidenceKo,
  formatDirectionKo,
  formatHorizonKo,
  formatHypothesisKo,
  formatScenarioKo,
  formatUrgencyKo,
  translateDisplayKo
} from "./korean-format.ts";
import type { SecurityReport, SecurityReportConfidence, SecurityReportSection } from "./report-schema.ts";

export function composeSecurityReport(context: AnswerContext, answer: RuntimeAnswer): SecurityReport {
  const pendingApprovals = context.approvals.filter((approval) => approval.status === "pending");
  const sourceReview = context.teamResult?.outputs.sourceReview;
  const fetchedEvidence = context.fetchedEvidence ?? [];
  const sourceVetFlags = sourceReview?.flags ?? [];

  return {
    title: answer.title,
    executiveAnswer: answer.directAnswer,
    bottomLine: answer.keyFindings.slice(0, 4),
    confidence: estimateReportConfidence(context, answer),
    facts: section("확인된 사실", "fact", buildFactItems(context, answer)),
    analysis: section("분석 판단", "inference", buildAnalysisItems(context, answer)),
    forecast: section("예측 및 관찰 지표", "forecast", buildForecastItems(context)),
    uncertainty: section("불확실성", "uncertainty", answer.uncertainty),
    collectionGaps: section("수집 공백", "action", [
      ...answer.nextSteps,
      ...pendingApprovals.map((approval) => `${approval.action.name} 승인 전까지 실시간 근거는 판단에 반영하지 않습니다.`),
      ...(sourceVetFlags.length > 0 ? sourceVetFlags.map((flag) => `SourceVet 확인 필요: ${translateDisplayKo(flag.summary)}`) : []),
      ...(fetchedEvidence.length === 0 ? ["승인 후 수집 또는 RAG 근거가 아직 부족합니다."] : [])
    ]),
    watchIndicators: section("감시 지표", "action", buildWatchIndicators(context)),
    sourceAuthorityRefs: answer.authorityRefs,
    warnings: answer.warnings
  };
}

function estimateReportConfidence(context: AnswerContext, answer: RuntimeAnswer): SecurityReportConfidence {
  const ach = context.teamResult?.outputs.ach;
  const pendingApprovals = context.approvals.filter((approval) => approval.status === "pending");
  const evidenceCount = ach?.caseRecord.evidence.length ?? 0;
  const sourceVetFlags = context.teamResult?.outputs.sourceReview?.flags.length ?? 0;
  if (pendingApprovals.length > 0 || evidenceCount === 0) {
    return {
      level: "low",
      rationale: "승인 대기 또는 구조화 evidence 부족으로 예측 신뢰도를 낮게 둡니다."
    };
  }
  if (sourceVetFlags > 0 || answer.uncertainty.length > 3) {
    return {
      level: "medium",
      rationale: "근거는 있으나 SourceVet 플래그 또는 잔여 불확실성이 남아 있습니다."
    };
  }
  return {
    level: "high",
    rationale: "승인 상태, 구조화 evidence, ACH 검증이 모두 통과한 범위의 상대적 신뢰도입니다."
  };
}

function buildForecastItems(context: AnswerContext): string[] {
  const plan = context.investigationPlan;
  const forecast = context.forecast;
  const ach = context.teamResult?.outputs.ach;
  const survivors = ach?.survivors ?? [];
  const indicators = plan?.hypotheses.flatMap((hypothesis) => hypothesis.indicators).slice(0, 6) ?? [];
  return uniqueNonEmpty([
    forecast
      ? `P24 예측: ${formatHorizonKo(forecast.horizon.label, forecast.horizon.months)} 기준 기준확률=${formatPercent(forecast.estimate.probability)}, 범위=${formatRange(forecast.estimate.probabilityRange)}, 신뢰도=${formatConfidenceKo(forecast.estimate.confidenceBand.label)}.`
      : undefined,
    ...(forecast?.scenarioSet.scenarios.map(
      (scenario) => `${translateDisplayKo(scenario.label)}: ${formatPercent(scenario.probability)} (${formatRange(scenario.probabilityRange)}).`
    ) ?? []),
    plan ? `시나리오: ${formatScenarioKo(plan.classification.scenario)}, 신뢰도=${plan.classification.confidence.toFixed(2)}.` : undefined,
    survivors.length > 0 ? `현재 생존 가설: ${survivors.map(formatHypothesisKo).join(", ")}.` : undefined,
    !forecast && indicators.length > 0 ? `주요 관찰 지표: ${indicators.map(translateDisplayKo).join(", ")}.` : undefined
  ]);
}

function buildWatchIndicators(context: AnswerContext): string[] {
  const fromForecast = context.forecast?.watchlist.items.map(
    (item) =>
      `[${formatUrgencyKo(item.urgency)}] ${translateDisplayKo(item.title)}: ${translateDisplayKo(item.trigger)} (${formatDirectionKo(item.direction)})`
  ) ?? [];
  const plan = context.investigationPlan;
  const fromPlan = plan?.hypotheses.flatMap((hypothesis) => [
    ...hypothesis.indicators.slice(0, 2),
    ...hypothesis.disconfirmingIndicators.slice(0, 1)
  ]) ?? [];
  const fromRfi = context.teamResult?.outputs.ach?.rfi ? [context.teamResult.outputs.ach.rfi] : [];
  return uniqueNonEmpty([...fromForecast, ...fromPlan.map(translateDisplayKo), ...fromRfi.map(translateDisplayKo)]).slice(0, 8);
}

function buildFactItems(context: AnswerContext, answer: RuntimeAnswer): string[] {
  return uniqueNonEmpty([
    ...answer.evidenceUsed,
    context.ragContext ? `로컬 RAG 검색 결과: 지식 단위 ${context.ragContext.units.length}건.` : undefined,
    context.claimGraph
      ? `근거 그래프: 정규화 주장 ${context.claimGraph.canonicalClaimCount}개, 반박 관계 ${context.claimGraph.contradictionCount}개.`
      : undefined,
    context.evidenceLedger ? `근거 원장: 항목 ${context.evidenceLedger.entries.length}개, 출처 연결 ${context.evidenceLedger.lineageEdges.length}개.` : undefined
  ]);
}

function buildAnalysisItems(context: AnswerContext, answer: RuntimeAnswer): string[] {
  return uniqueNonEmpty([
    ...answer.keyFindings,
    context.domainExpansion
      ? `온톨로지 확장: 시나리오=${context.domainExpansion.scenarios.map((item) => formatScenarioKo(item.id)).join(", ") || "없음"}, 수집원 힌트=${context.domainExpansion.sourceHints.length}개.`
      : undefined
  ]);
}

function section(title: string, kind: SecurityReportSection["kind"], items: string[]): SecurityReportSection {
  return {
    title,
    kind,
    items: uniqueNonEmpty(items)
  };
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

function formatPercent(value: number): string {
  return `${Math.round(value * 10_000) / 100}%`;
}

function formatRange(range: { lower: number; upper: number }): string {
  return `${formatPercent(range.lower)}-${formatPercent(range.upper)}`;
}
