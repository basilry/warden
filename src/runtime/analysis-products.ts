import { buildClaimGraph, type ClaimGraph } from "../agent/claim-graph/index.ts";
import { buildEvidenceLedger, type EvidenceLedger } from "../agent/evidence-ledger.ts";
import type { KnowledgeUnit, TeamRunResult } from "../agent/types.ts";
import { createLocalRagRegistry, retrieveLocalRagContext } from "../connectors/rag/retrieval.ts";
import type { LocalRagRetrievalResult } from "../connectors/rag/types.ts";
import { expandDomainQuery, type DomainQueryExpansion } from "../domain/index.ts";
import {
  buildScenarioSet,
  calculateForecast,
  renderWatchlist,
  scoreIndicators,
  type ForecastEvidenceIndicator,
  type ForecastEstimate,
  type ForecastHorizon,
  type ForecastQuestion,
  type ForecastScenarioSet,
  type ForecastWatchlist
} from "../forecast/index.ts";
import type { InvestigationPlan } from "./investigation-plan-schema.ts";

export type RuntimeForecastProducts = {
  question: ForecastQuestion;
  horizon: ForecastHorizon;
  indicators: ForecastEvidenceIndicator[];
  estimate: ForecastEstimate;
  scenarioSet: ForecastScenarioSet;
  watchlist: ForecastWatchlist;
  warnings: string[];
};

export type RuntimeAnalysisProducts = {
  domainExpansion?: DomainQueryExpansion;
  ragContext?: LocalRagRetrievalResult;
  claimGraph?: ClaimGraph;
  evidenceLedger?: EvidenceLedger;
  forecast?: RuntimeForecastProducts;
};

export type RuntimeAnalysisInput = {
  objective: string;
  investigationPlan?: InvestigationPlan;
  teamResult?: TeamRunResult;
  fetchedEvidence?: KnowledgeUnit[];
  existing?: RuntimeAnalysisProducts;
};

export function buildRuntimeAnalysisProducts(input: RuntimeAnalysisInput): RuntimeAnalysisProducts {
  const domainExpansion = input.existing?.domainExpansion ?? safeDomainExpansion(input.objective);
  const ragContext =
    input.existing?.ragContext ?? safeRagContext(input.objective, input.investigationPlan, domainExpansion);
  const units = collectKnowledgeUnits({
    teamResult: input.teamResult,
    fetchedEvidence: input.fetchedEvidence,
    ragContext
  });
  const claimGraph = units.length > 0 ? buildClaimGraph(units) : input.existing?.claimGraph;
  const evidenceLedger = units.length > 0 && claimGraph ? buildEvidenceLedger(units, { graph: claimGraph }) : input.existing?.evidenceLedger;
  const forecast =
    input.investigationPlan || domainExpansion
      ? buildForecastProducts({
          objective: input.objective,
          investigationPlan: input.investigationPlan,
          domainExpansion,
          units
        })
      : input.existing?.forecast;

  return {
    domainExpansion,
    ragContext,
    claimGraph,
    evidenceLedger,
    forecast
  };
}

export function collectKnowledgeUnits(input: {
  teamResult?: TeamRunResult;
  fetchedEvidence?: KnowledgeUnit[];
  ragContext?: LocalRagRetrievalResult;
}): KnowledgeUnit[] {
  const byId = new Map<string, KnowledgeUnit>();
  for (const unit of [
    ...(input.ragContext?.units ?? []),
    ...(input.teamResult?.outputs.knowledgeUnits ?? []),
    ...(input.fetchedEvidence ?? [])
  ]) {
    if (!byId.has(unit.id)) byId.set(unit.id, unit);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function safeDomainExpansion(objective: string): DomainQueryExpansion | undefined {
  try {
    return expandDomainQuery(objective);
  } catch {
    return undefined;
  }
}

function safeRagContext(
  objective: string,
  plan: InvestigationPlan | undefined,
  expansion: DomainQueryExpansion | undefined
): LocalRagRetrievalResult | undefined {
  try {
    const registry = createLocalRagRegistry();
    return retrieveLocalRagContext(buildRagQuery(objective, plan, expansion), registry.index, {
      limit: 6,
      minScore: 0.01
    });
  } catch {
    return undefined;
  }
}

function buildForecastProducts(input: {
  objective: string;
  investigationPlan?: InvestigationPlan;
  domainExpansion?: DomainQueryExpansion;
  units: KnowledgeUnit[];
}): RuntimeForecastProducts {
  const question = buildForecastQuestion(input.objective, input.investigationPlan, input.domainExpansion);
  const horizon = buildDefaultHorizon();
  const indicators = buildForecastIndicators(input.investigationPlan, input.domainExpansion, input.units);
  const indicatorAssessment = scoreIndicators(indicators);
  const estimate = calculateForecast(question, horizon, {
    indicators,
    indicatorAssessment
  });
  return {
    question,
    horizon,
    indicators,
    estimate,
    scenarioSet: buildScenarioSet(question, horizon, estimate),
    watchlist: renderWatchlist(question, {
      indicators,
      indicatorAssessment,
      maxItems: 6
    }),
    warnings: buildForecastWarnings(input.units, input.investigationPlan)
  };
}

function buildForecastQuestion(
  objective: string,
  plan: InvestigationPlan | undefined,
  expansion: DomainQueryExpansion | undefined
): ForecastQuestion {
  const scenario = plan?.classification.scenario;
  const eventType =
    scenario === "taiwan_invasion"
      ? "cross_strait_invasion"
      : scenario === "korea_northeast_asia_supply_chain"
        ? "supply_chain_disruption"
        : scenario === "sanctions_export_controls"
          ? "sanctions_export_controls"
          : scenario === "us_alliance_response"
            ? "alliance_policy_response"
            : scenario === "claim_verification"
              ? "geopolitical_claim_validity"
          : "military_crisis";
  const geography = firstNonEmpty([
    expansion?.regions.map((region) => region.label).join(", "),
    scenario === "taiwan_invasion" ? "Taiwan Strait" : undefined,
    scenario === "korea_northeast_asia_supply_chain" ? "Northeast Asia" : undefined,
    scenario === "us_alliance_response" ? "South Korea / United States" : undefined,
    scenario === "claim_verification" ? "Japan / Korean Peninsula / Northeast Asia" : undefined
  ]);

  return {
    id: `runtime_forecast_${sanitizeId(scenario ?? "generic")}`,
    text: objective,
    eventType,
    geography,
    referenceClass: referenceClassForScenario(scenario),
    assumptions: [
      "Runtime forecast is a structured analytic estimate, not a deterministic prediction.",
      "Live OSINT and analyst-confirmed indicator scoring can revise this estimate."
    ],
    prior: priorForScenario(scenario),
    tags: uniqueNonEmpty(["runtime", "forecast", plan?.domain, scenario, ...(expansion?.scenarios.map((item) => item.id) ?? [])])
  };
}

function buildDefaultHorizon(): ForecastHorizon {
  const start = new Date();
  const end = new Date(start.getTime());
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return {
    label: "next 12 months",
    months: 12,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

function buildForecastIndicators(
  plan: InvestigationPlan | undefined,
  expansion: DomainQueryExpansion | undefined,
  units: KnowledgeUnit[]
): ForecastEvidenceIndicator[] {
  const observedTerms = buildObservedTermSet(units);
  const fromPlan =
    plan?.hypotheses.flatMap((hypothesis, hypothesisIndex) =>
      [
        ...hypothesis.indicators.slice(0, 2).map((label, index) =>
          indicatorFromText(`plan_${hypothesis.id}_raise_${index}`, label, "raises", observedTerms, hypothesis.priority)
        ),
        ...hypothesis.disconfirmingIndicators.slice(0, 1).map((label, index) =>
          indicatorFromText(`plan_${hypothesis.id}_lower_${index}`, label, "lowers", observedTerms, hypothesis.priority)
        )
      ].map((indicator) => ({
        ...indicator,
        weight: indicator.weight ?? priorityWeight(hypothesis.priority, hypothesisIndex)
      }))
    ) ?? [];
  const fromOntology =
    expansion?.signals.slice(0, 6).map((signal, index) =>
      indicatorFromText(
        `ontology_${signal.id}`,
        signal.label,
        signal.polarity === "stabilizing" ? "lowers" : "raises",
        observedTerms,
        index < 2 ? "high" : "medium"
      )
    ) ?? [];

  const indicators = uniqueIndicators([...fromPlan, ...fromOntology]);
  return indicators.length > 0 ? indicators.slice(0, 10) : defaultForecastIndicators(observedTerms);
}

function indicatorFromText(
  id: string,
  label: string,
  direction: ForecastEvidenceIndicator["direction"],
  observedTerms: Set<string>,
  priority: "high" | "medium" | "low"
): ForecastEvidenceIndicator {
  const normalizedLabel = normalizeText(label);
  const observed = [...observedTerms].some((term) => term.length >= 3 && normalizedLabel.includes(term));
  return {
    id: sanitizeId(id),
    label,
    category: inferIndicatorCategory(label),
    direction,
    observed,
    strength: priority === "high" ? 0.72 : priority === "medium" ? 0.58 : 0.42,
    confidence: observed ? 0.62 : 0.48,
    weight: priority === "high" ? 1.15 : priority === "medium" ? 0.9 : 0.7,
    evidence: observed ? "로컬/RAG/런타임 근거 용어와 매칭되었습니다." : "아직 로컬 근거에서 관측되지 않았습니다.",
    watchTrigger: direction === "raises" ? `상승 신호를 교차확인: ${label}.` : `반증 신호를 교차확인: ${label}.`
  };
}

function defaultForecastIndicators(observedTerms: Set<string>): ForecastEvidenceIndicator[] {
  return [
    indicatorFromText("default_capability_mobilization", "비가역적 동원 또는 물류 이동", "raises", observedTerms, "high"),
    indicatorFromText("default_crisis_controls", "위기 채널과 억제 신호 유지", "lowers", observedTerms, "medium"),
    indicatorFromText("default_economic_friction", "시장, 물류, 보험 마찰 증가", "raises", observedTerms, "medium")
  ];
}

function buildObservedTermSet(units: KnowledgeUnit[]): Set<string> {
  const text = units
    .flatMap((unit) => [unit.sourceUri, ...unit.tags, ...unit.claims.map((claim) => claim.text)])
    .join(" ");
  return new Set(
    normalizeText(text)
      .split(" ")
      .filter((term) => term.length >= 3)
  );
}

function buildRagQuery(
  objective: string,
  plan: InvestigationPlan | undefined,
  expansion: DomainQueryExpansion | undefined
): string {
  return uniqueNonEmpty([
    objective,
    plan?.classification.scenario,
    plan?.domain,
    ...(plan?.searchPlan.flatMap((step) => [step.query, ...step.tags]).slice(0, 12) ?? []),
    ...(expansion?.expandedTerms.actors.slice(0, 5) ?? []),
    ...(expansion?.expandedTerms.regions.slice(0, 5) ?? []),
    ...(expansion?.expandedTerms.sectors.slice(0, 5) ?? []),
    ...(expansion?.expandedTerms.risks.slice(0, 5) ?? [])
  ]).join(" ");
}

function referenceClassForScenario(scenario: InvestigationPlan["classification"]["scenario"] | undefined): string {
  if (scenario === "taiwan_invasion") return "cross-strait crisis escalation under high military and economic cost";
  if (scenario === "korea_northeast_asia_supply_chain") return "Northeast Asia strategic supply-chain disruption";
  if (scenario === "sanctions_export_controls") return "sanctions and export-control disruption";
  if (scenario === "us_alliance_response") return "US alliance-management responses to allied policy divergence";
  if (scenario === "claim_verification") return "verification of extraordinary geopolitical claims against public primary sources";
  return "strategic security crisis escalation";
}

function priorForScenario(scenario: InvestigationPlan["classification"]["scenario"] | undefined): ForecastQuestion["prior"] {
  if (scenario === "taiwan_invasion") {
    return {
      annualProbability: 0.06,
      observedEvents: 2,
      totalCases: 32,
      referenceClass: "rare major-power amphibious invasion attempts under deterrence",
      rationale: ["전면 침공은 비용이 크고 가시성이 높으며 작전 제약이 커서 회색지대 고조보다 낮게 둡니다."]
    };
  }
  if (scenario === "korea_northeast_asia_supply_chain") {
    return {
      annualProbability: 0.18,
      observedEvents: 7,
      totalCases: 36,
      referenceClass: "strategic industrial supply-chain disruptions",
      rationale: ["공급망 차질은 물리적 충돌보다 빈도가 높지만 심각도 편차가 큽니다."]
    };
  }
  if (scenario === "us_alliance_response") {
    return {
      annualProbability: 0.16,
      observedEvents: 6,
      totalCases: 38,
      referenceClass: "public US alliance friction responses to allied policy divergence",
      rationale: ["동맹 이견은 흔하지만 공개 충돌보다 비공개 조율과 조건부 우려 표명이 더 자주 나타난다는 기준확률을 둡니다."]
    };
  }
  if (scenario === "claim_verification") {
    return {
      annualProbability: 0.04,
      observedEvents: 1,
      totalCases: 28,
      referenceClass: "extraordinary geopolitical claims later confirmed by public primary evidence",
      rationale: ["비밀 영토 재점령 또는 침공 계획 주장은 공개 1차 근거가 없으면 낮은 기준확률에서 출발해야 합니다."]
    };
  }
  return undefined;
}

function buildForecastWarnings(units: KnowledgeUnit[], plan: InvestigationPlan | undefined): string[] {
  return uniqueNonEmpty([
    units.length === 0 ? "지표 관찰에 사용할 로컬 근거 단위가 없습니다." : undefined,
    plan?.source === "deterministic_fallback" ? "예측 질문은 규칙 기반 대체 분석계획에서 생성되었습니다." : undefined,
    "확률은 제한된 분석 추정치이며 사실 예측으로 취급하면 안 됩니다."
  ]);
}

function inferIndicatorCategory(label: string): ForecastEvidenceIndicator["category"] {
  const normalized = normalizeText(label);
  if (/mobilization|logistics|amphibious|missile|exercise|military|상륙|훈련|미사일|군/.test(normalized)) return "military";
  if (/insurance|shipping|port|market|export|supply|공급|수출|항만|물류|보험/.test(normalized)) return "economic";
  if (/deterrence|diplomatic|allied|외교|동맹|억제/.test(normalized)) return "diplomatic";
  if (/leadership|intent|rhetoric|지도부|발언|의도/.test(normalized)) return "intent";
  if (/constraint|cost|제약|비용/.test(normalized)) return "constraint";
  return "warning";
}

function priorityWeight(priority: "high" | "medium" | "low", index: number): number {
  const base = priority === "high" ? 1.2 : priority === "medium" ? 0.95 : 0.75;
  return Math.max(0.5, Number((base - index * 0.05).toFixed(2)));
}

function uniqueIndicators(indicators: ForecastEvidenceIndicator[]): ForecastEvidenceIndicator[] {
  const byId = new Map<string, ForecastEvidenceIndicator>();
  for (const indicator of indicators) {
    if (!byId.has(indicator.id)) byId.set(indicator.id, indicator);
  }
  return [...byId.values()];
}

function sanitizeId(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim());
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
