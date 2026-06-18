import type {
  ForecastBaseRate,
  ForecastConfidenceBand,
  ForecastEvidenceIndicator,
  ForecastHorizon,
  ForecastIndicatorAssessment,
  ForecastIndicatorScore,
  ForecastQuestion,
  ForecastScenario,
  ForecastScenarioSet,
  ForecastWatchItem,
  ForecastWatchlist,
  ProbabilityRange
} from "./types.ts";

export type CalculateForecastOptions = {
  baseRate?: ForecastBaseRate;
  indicators?: ForecastEvidenceIndicator[];
  indicatorAssessment?: ForecastIndicatorAssessment;
};

export type RenderWatchlistOptions = {
  indicators?: ForecastEvidenceIndicator[];
  indicatorAssessment?: ForecastIndicatorAssessment;
  maxItems?: number;
};

const DEFAULT_ANNUAL_PROBABILITY = 0.1;
const DEFAULT_FORECAST_MONTHS = 12;

const EVENT_TYPE_ANNUAL_PRIORS: Record<string, number> = {
  cross_strait_invasion: 0.06,
  taiwan_invasion: 0.06,
  invasion: 0.08,
  military_crisis: 0.12,
  blockade: 0.14,
  supply_chain_disruption: 0.18,
  default: DEFAULT_ANNUAL_PROBABILITY
};

export function estimateBaseRate(question: ForecastQuestion, horizon: ForecastHorizon): ForecastBaseRate {
  const horizonMonths = resolveHorizonMonths(horizon);
  const prior = question.prior;
  const suppliedAnnualProbability = prior?.annualProbability;
  const observedEvents = parseOptionalCount(prior?.observedEvents);
  const totalCases = parseOptionalCount(prior?.totalCases);
  const referenceClass =
    prior?.referenceClass ?? question.referenceClass ?? question.eventType ?? "generic strategic forecast";
  const rationale: string[] = [];

  let annualProbability: number;
  if (isProbability(suppliedAnnualProbability)) {
    annualProbability = suppliedAnnualProbability;
    rationale.push(`Used supplied annual prior ${formatPercent(annualProbability)} for ${referenceClass}.`);
  } else if (observedEvents !== undefined && totalCases !== undefined && totalCases > 0) {
    annualProbability = clampProbability((observedEvents + 1) / (totalCases + 2));
    rationale.push(
      `Used Laplace-smoothed reference frequency (${observedEvents}+1)/(${totalCases}+2) for ${referenceClass}.`
    );
  } else {
    annualProbability = defaultAnnualProbability(question.eventType);
    rationale.push(`Used default annual prior ${formatPercent(annualProbability)} for event type ${question.eventType ?? "default"}.`);
  }

  if (prior?.rationale?.length) {
    rationale.push(...prior.rationale);
  }

  const effectiveCases = totalCases ?? (isProbability(suppliedAnnualProbability) ? 20 : 8);
  const annualUncertainty = estimateAnnualUncertainty(annualProbability, effectiveCases);
  const lowerAnnual = clampProbability(annualProbability - annualUncertainty);
  const upperAnnual = clampProbability(annualProbability + annualUncertainty);
  const probability = annualToHorizonProbability(annualProbability, horizonMonths);
  const probabilityRange = makeRange(
    annualToHorizonProbability(lowerAnnual, horizonMonths),
    annualToHorizonProbability(upperAnnual, horizonMonths)
  );

  rationale.push(`Scaled annual probability to ${formatMonths(horizonMonths)} with complementary probability math.`);

  return {
    questionId: question.id,
    horizon,
    horizonMonths,
    referenceClass,
    annualProbability: roundProbability(annualProbability),
    probability: roundProbability(probability),
    probabilityRange,
    observedEvents,
    totalCases,
    confidence: confidenceFromCases(effectiveCases),
    rationale
  };
}

export function scoreIndicators(indicators: ForecastEvidenceIndicator[]): ForecastIndicatorAssessment {
  const scores = indicators.map(scoreIndicator);
  const totalWeight = scores.reduce((sum, score) => sum + score.weight, 0);
  const denominator = totalWeight > 0 ? totalWeight : 1;
  const rawSupport = scores.reduce((sum, score) => sum + Math.max(0, score.contribution), 0);
  const rawDrag = scores.reduce((sum, score) => sum + Math.abs(Math.min(0, score.contribution)), 0);
  const netScore = clamp((rawSupport - rawDrag) / denominator, -1, 1);
  const supportScore = clamp(rawSupport / denominator, 0, 1);
  const dragScore = clamp(rawDrag / denominator, 0, 1);
  const observedScores = scores.filter((score) => score.observed);
  const confidenceDenominator = observedScores.reduce((sum, score) => sum + score.weight, 0);
  const confidence =
    confidenceDenominator > 0
      ? observedScores.reduce((sum, score) => sum + score.confidence * score.weight, 0) / confidenceDenominator
      : 0.5;

  return {
    scores,
    netScore: roundScore(netScore),
    supportScore: roundScore(supportScore),
    dragScore: roundScore(dragScore),
    confidence: roundScore(confidence),
    rationale: [
      `Net indicator score ${roundScore(netScore)} from support ${roundScore(supportScore)} and drag ${roundScore(dragScore)}.`,
      "Each contribution equals direction * observed * weight * strength * confidence, normalized by total weight."
    ]
  };
}

export function calculateForecast(
  question: ForecastQuestion,
  horizon: ForecastHorizon,
  options: CalculateForecastOptions = {}
): ForecastEstimate {
  const baseRate = options.baseRate ?? estimateBaseRate(question, horizon);
  const indicatorAssessment = options.indicatorAssessment ?? scoreIndicators(options.indicators ?? []);
  const baseProbability = baseRate.probability;
  const positiveAdjustment = (1 - baseProbability) * Math.max(0, indicatorAssessment.netScore) * 0.18;
  const negativeAdjustment = baseProbability * Math.min(0, indicatorAssessment.netScore) * 0.75;
  const adjustment = positiveAdjustment + negativeAdjustment;
  const probability = clampProbability(baseProbability + adjustment);
  const confidenceBand = buildConfidenceBand(probability, baseRate, indicatorAssessment);

  return {
    question,
    horizon,
    baseRate,
    indicatorAssessment,
    probability: roundProbability(probability),
    probabilityRange: makeRange(confidenceBand.lower, confidenceBand.upper),
    confidenceBand,
    adjustment: roundProbability(adjustment),
    rationale: [
      `Started from base rate ${formatPercent(baseProbability)} over ${formatMonths(baseRate.horizonMonths)}.`,
      `Applied bounded indicator adjustment ${formatSignedPercent(adjustment)} from net score ${indicatorAssessment.netScore}.`,
      `Final estimate is ${formatPercent(probability)} with a ${confidenceBand.label}-confidence band.`
    ]
  };
}

export function buildScenarioSet(
  question: ForecastQuestion,
  horizon: ForecastHorizon,
  estimate: ForecastEstimate
): ForecastScenarioSet {
  const eventProbability = estimate.probability;
  const remainingProbability = clamp(1 - eventProbability, 0, 1);
  const coercionShare = clamp(
    0.35 + estimate.indicatorAssessment.supportScore * 0.35 - estimate.indicatorAssessment.dragScore * 0.15,
    0.2,
    0.65
  );
  const coercionProbability = remainingProbability * coercionShare;
  const baselineProbability = remainingProbability - coercionProbability;
  const raisingDrivers = topDrivers(estimate.indicatorAssessment.scores, "raises");
  const loweringDrivers = topDrivers(estimate.indicatorAssessment.scores, "lowers");
  const eventLabel = eventScenarioLabel(question);

  const scenarios: ForecastScenario[] = [
    {
      id: "baseline_no_event",
      label: "Baseline: pressure stays below event threshold",
      probability: roundProbability(baselineProbability),
      probabilityRange: makeRange(
        clamp(1 - estimate.probabilityRange.upper - coercionProbability * 1.1, 0, 1),
        clamp(1 - estimate.probabilityRange.lower - coercionProbability * 0.8, 0, 1)
      ),
      drivers: loweringDrivers.length ? loweringDrivers : ["No decisive warning indicators dominate the estimate."],
      signposts: [
        "Crisis communications remain active.",
        "No broad national mobilization order appears.",
        "Forward deployments remain exercise-sized or reversible."
      ]
    },
    {
      id: "coercive_escalation",
      label: "Coercive escalation without forecast event",
      probability: roundProbability(coercionProbability),
      probabilityRange: widenPoint(coercionProbability, 0.08),
      drivers: raisingDrivers.concat(loweringDrivers).slice(0, 4),
      signposts: [
        "Expanded exercises or exclusion zones around the target area.",
        "Cyber, information, or economic pressure increases.",
        "Diplomatic signaling leaves space for de-escalation."
      ]
    },
    {
      id: "forecast_event",
      label: eventLabel,
      probability: roundProbability(eventProbability),
      probabilityRange: estimate.probabilityRange,
      drivers: raisingDrivers.length ? raisingDrivers : ["Base-rate risk remains even without strong warning indicators."],
      signposts: [
        "Large-scale logistics, sealift, airlift, or medical mobilization becomes visible.",
        "Political leadership accepts high economic and military costs.",
        "Operational deployments become hard to reverse."
      ]
    }
  ];

  return {
    questionId: question.id,
    horizon,
    scenarios,
    rationale: [
      "Scenario probabilities split the non-event probability between baseline pressure and coercive escalation.",
      "The forecast-event scenario uses the calculated probability directly."
    ]
  };
}

export function renderWatchlist(question: ForecastQuestion, options: RenderWatchlistOptions = {}): ForecastWatchlist {
  const maxItems = Math.max(1, Math.min(options.maxItems ?? 6, 12));
  const assessment = options.indicatorAssessment ?? scoreIndicators(options.indicators ?? []);
  const ranked = [...assessment.scores]
    .filter((score) => score.observed || Math.abs(score.contribution) > 0)
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));
  const items = ranked.slice(0, maxItems).map((score) => watchItemFromScore(score, options.indicators ?? []));
  const filledItems = items.length ? items : defaultWatchItems(question).slice(0, maxItems);
  const text = filledItems
    .map(
      (item, index) =>
        `${index + 1}. [${item.urgency}] ${item.title}: ${item.trigger} (${item.direction} probability)`
    )
    .join("\n");

  return {
    questionId: question.id,
    items: filledItems,
    text
  };
}

function scoreIndicator(indicator: ForecastEvidenceIndicator): ForecastIndicatorScore {
  const weight = clamp(indicator.weight ?? 1, 0, 3);
  const strength = clamp(indicator.strength, 0, 1);
  const confidence = clamp(indicator.confidence, 0, 1);
  const direction = indicator.direction === "raises" ? 1 : -1;
  const contribution = indicator.observed ? direction * weight * strength * confidence : 0;
  const rationale = indicator.observed
    ? `${indicator.label} ${indicator.direction} the estimate by ${roundScore(Math.abs(contribution))} raw points.`
    : `${indicator.label} is not observed, so it contributes no adjustment.`;

  return {
    id: indicator.id,
    label: indicator.label,
    category: indicator.category,
    direction: indicator.direction,
    observed: indicator.observed,
    strength: roundScore(strength),
    confidence: roundScore(confidence),
    weight: roundScore(weight),
    contribution: roundScore(contribution),
    rationale
  };
}

function buildConfidenceBand(
  probability: number,
  baseRate: ForecastBaseRate,
  indicatorAssessment: ForecastIndicatorAssessment
): ForecastConfidenceBand {
  const baseHalfWidth = (baseRate.probabilityRange.upper - baseRate.probabilityRange.lower) / 2;
  const indicatorUncertainty = (1 - indicatorAssessment.confidence) * 0.08;
  const scoreUncertainty = Math.abs(indicatorAssessment.netScore) * 0.02;
  const width = clamp(Math.max(0.02, baseHalfWidth * 0.65 + indicatorUncertainty + scoreUncertainty), 0.02, 0.35);
  const band = widenPoint(probability, width);
  const label = width <= 0.05 && indicatorAssessment.confidence >= 0.65 ? "high" : width <= 0.1 ? "medium" : "low";

  return {
    ...band,
    label,
    width: roundProbability(width)
  };
}

function defaultAnnualProbability(eventType: string | undefined): number {
  if (!eventType) return DEFAULT_ANNUAL_PROBABILITY;
  return EVENT_TYPE_ANNUAL_PRIORS[eventType] ?? DEFAULT_ANNUAL_PROBABILITY;
}

function resolveHorizonMonths(horizon: ForecastHorizon): number {
  if (Number.isFinite(horizon.months) && (horizon.months ?? 0) > 0) {
    return roundMonths(horizon.months ?? DEFAULT_FORECAST_MONTHS);
  }
  if (horizon.startDate && horizon.endDate) {
    const start = Date.parse(horizon.startDate);
    const end = Date.parse(horizon.endDate);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const days = (end - start) / 86_400_000;
      return roundMonths(days / 30.4375);
    }
  }
  return DEFAULT_FORECAST_MONTHS;
}

function annualToHorizonProbability(annualProbability: number, months: number): number {
  return clampProbability(1 - Math.pow(1 - annualProbability, months / 12));
}

function estimateAnnualUncertainty(probability: number, cases: number): number {
  const effectiveCases = Math.max(2, cases);
  const standardError = Math.sqrt((probability * (1 - probability)) / (effectiveCases + 4));
  return Math.max(0.015, standardError * 1.28);
}

function confidenceFromCases(cases: number): "low" | "medium" | "high" {
  if (cases >= 50) return "high";
  if (cases >= 15) return "medium";
  return "low";
}

function topDrivers(
  scores: ForecastIndicatorScore[],
  direction: "raises" | "lowers",
  limit = 3
): string[] {
  return scores
    .filter((score) => score.direction === direction && score.observed && Math.abs(score.contribution) > 0)
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .slice(0, limit)
    .map((score) => score.label);
}

function eventScenarioLabel(question: ForecastQuestion): string {
  const eventType = question.eventType ?? "";
  if (eventType.includes("taiwan") || eventType.includes("cross_strait")) {
    return "Large-scale Taiwan invasion attempt";
  }
  return "Forecast event occurs";
}

function watchItemFromScore(
  score: ForecastIndicatorScore,
  indicators: ForecastEvidenceIndicator[]
): ForecastWatchItem {
  const source = indicators.find((indicator) => indicator.id === score.id);
  const contributionMagnitude = Math.abs(score.contribution);
  const urgency = contributionMagnitude >= 0.6 ? "near_term" : contributionMagnitude >= 0.25 ? "monitor" : "background";
  const trigger =
    source?.watchTrigger ??
    (score.direction === "raises"
      ? `Corroborated evidence strengthens: ${score.label}.`
      : `Corroborated evidence weakens or reverses: ${score.label}.`);

  return {
    id: `watch_${score.id}`,
    title: score.label,
    category: score.category,
    trigger,
    direction: score.direction,
    urgency,
    linkedIndicatorIds: [score.id],
    rationale: `Current contribution is ${score.contribution}; watch for movement because this is a high-leverage indicator.`
  };
}

function defaultWatchItems(question: ForecastQuestion): ForecastWatchItem[] {
  const eventPrefix = question.eventType?.includes("cross_strait") || question.eventType?.includes("taiwan") ? "cross-strait" : "forecast";
  return [
    {
      id: "watch_mobilization",
      title: "Mobilization and logistics posture",
      category: "military",
      trigger: `Visible irreversible ${eventPrefix} logistics, medical, or transport mobilization.`,
      direction: "raises",
      urgency: "near_term",
      linkedIndicatorIds: [],
      rationale: "Mobilization is usually closer to action than rhetoric or exercises."
    },
    {
      id: "watch_deterrence",
      title: "Deterrence and crisis-control signals",
      category: "diplomatic",
      trigger: "Reliable signs that crisis channels, allied posture, or cost-imposition signals are changing.",
      direction: "lowers",
      urgency: "monitor",
      linkedIndicatorIds: [],
      rationale: "Deterrence and crisis management can cap escalation even when pressure rises."
    }
  ];
}

function parseOptionalCount(value: unknown): number | undefined {
  if (!Number.isInteger(value) || (value as number) < 0) return undefined;
  return value as number;
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function clampProbability(value: number): number {
  return clamp(value, 0.001, 0.999);
}

function makeRange(lower: number, upper: number): ProbabilityRange {
  const safeLower = clampProbability(Math.min(lower, upper));
  const safeUpper = clampProbability(Math.max(lower, upper));
  return {
    lower: roundProbability(safeLower),
    upper: roundProbability(safeUpper)
  };
}

function widenPoint(point: number, width: number): ProbabilityRange {
  return makeRange(point - width, point + width);
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function roundProbability(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function roundMonths(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatPercent(value: number): string {
  return `${roundScore(value * 100)}%`;
}

function formatSignedPercent(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${formatPercent(value)}`;
}

function formatMonths(value: number): string {
  return `${value} month${value === 1 ? "" : "s"}`;
}
