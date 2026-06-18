import {
  buildScenarioSet,
  calculateForecast,
  estimateBaseRate,
  renderWatchlist,
  scoreIndicators,
  type ForecastBaseRate,
  type ForecastEvidenceIndicator,
  type ForecastEstimate,
  type ForecastHorizon,
  type ForecastIndicatorAssessment,
  type ForecastIndicatorCategory,
  type ForecastIndicatorDirection,
  type ForecastIndicatorScore,
  type ForecastQuestion
} from "../../forecast/index.ts";
import {
  isForecastMcpToolName,
  type BuildScenariosInput,
  type CalculateForecastInput,
  type EstimateBaseRateInput,
  type ForecastMcpInputByTool,
  type ForecastMcpOutputByTool,
  type ForecastMcpToolName,
  type GenerateWatchlistInput,
  type ScoreIndicatorsInput
} from "./types.ts";

const INDICATOR_CATEGORIES = [
  "intent",
  "capability",
  "opportunity",
  "constraint",
  "military",
  "diplomatic",
  "economic",
  "information",
  "warning",
  "other"
] as const;

export function dispatchForecastToolCall<TName extends ForecastMcpToolName>(
  name: TName,
  input: ForecastMcpInputByTool[TName]
): ForecastMcpOutputByTool[TName] {
  if (name === "estimate_base_rate") {
    const parsed = parseEstimateBaseRateInput(input);
    return { baseRate: estimateBaseRate(parsed.question, parsed.horizon) } as ForecastMcpOutputByTool[TName];
  }

  if (name === "score_indicators") {
    const parsed = parseScoreIndicatorsInput(input);
    return { indicatorAssessment: scoreIndicators(parsed.indicators) } as ForecastMcpOutputByTool[TName];
  }

  if (name === "calculate_forecast") {
    const parsed = parseCalculateForecastInput(input);
    return {
      estimate: calculateForecast(parsed.question, parsed.horizon, {
        baseRate: parsed.baseRate,
        indicators: parsed.indicators,
        indicatorAssessment: parsed.indicatorAssessment
      })
    } as ForecastMcpOutputByTool[TName];
  }

  if (name === "build_scenarios") {
    const parsed = parseBuildScenariosInput(input);
    const estimate =
      parsed.estimate ??
      calculateForecast(parsed.question, parsed.horizon, {
        baseRate: parsed.baseRate,
        indicators: parsed.indicators,
        indicatorAssessment: parsed.indicatorAssessment
      });
    return { scenarioSet: buildScenarioSet(parsed.question, parsed.horizon, estimate) } as ForecastMcpOutputByTool[TName];
  }

  const parsed = parseGenerateWatchlistInput(input);
  return {
    watchlist: renderWatchlist(parsed.question, {
      indicators: parsed.indicators,
      indicatorAssessment: parsed.indicatorAssessment,
      maxItems: parsed.maxItems
    })
  } as ForecastMcpOutputByTool[TName];
}

export function dispatchUnknownForecastToolCall(name: string, input: unknown): unknown {
  if (!isForecastMcpToolName(name)) {
    throw new Error(`Unknown forecast MCP tool: ${name}`);
  }
  return dispatchForecastToolCall(name, input as never);
}

function parseEstimateBaseRateInput(input: unknown): EstimateBaseRateInput {
  if (!isRecord(input)) {
    throw new Error("estimate_base_rate requires an object input.");
  }
  return {
    question: parseForecastQuestion(input.question, "question"),
    horizon: parseForecastHorizon(input.horizon, "horizon")
  };
}

function parseScoreIndicatorsInput(input: unknown): ScoreIndicatorsInput {
  if (!isRecord(input) || !Array.isArray(input.indicators)) {
    throw new Error("score_indicators requires { indicators: ForecastEvidenceIndicator[] }.");
  }
  return {
    indicators: input.indicators.map((indicator, index) => parseForecastIndicator(indicator, `indicators[${index}]`))
  };
}

function parseCalculateForecastInput(input: unknown): CalculateForecastInput {
  if (!isRecord(input)) {
    throw new Error("calculate_forecast requires an object input.");
  }
  return {
    question: parseForecastQuestion(input.question, "question"),
    horizon: parseForecastHorizon(input.horizon, "horizon"),
    baseRate: input.baseRate === undefined ? undefined : parseForecastBaseRate(input.baseRate, "baseRate"),
    indicators: input.indicators === undefined ? undefined : parseIndicatorArray(input.indicators, "indicators"),
    indicatorAssessment:
      input.indicatorAssessment === undefined
        ? undefined
        : parseForecastIndicatorAssessment(input.indicatorAssessment, "indicatorAssessment")
  };
}

function parseBuildScenariosInput(input: unknown): BuildScenariosInput {
  const parsed = parseCalculateForecastInput(input);
  if (!isRecord(input)) return parsed;
  return {
    ...parsed,
    estimate: input.estimate === undefined ? undefined : parseForecastEstimate(input.estimate, "estimate")
  };
}

function parseGenerateWatchlistInput(input: unknown): GenerateWatchlistInput {
  if (!isRecord(input)) {
    throw new Error("generate_watchlist requires an object input.");
  }
  return {
    question: parseForecastQuestion(input.question, "question"),
    indicators: input.indicators === undefined ? undefined : parseIndicatorArray(input.indicators, "indicators"),
    indicatorAssessment:
      input.indicatorAssessment === undefined
        ? undefined
        : parseForecastIndicatorAssessment(input.indicatorAssessment, "indicatorAssessment"),
    maxItems: input.maxItems === undefined ? undefined : parseInteger(input.maxItems, "maxItems", 1, 12)
  };
}

function parseForecastQuestion(input: unknown, label: string): ForecastQuestion {
  if (!isRecord(input)) {
    throw new Error(`${label} must be a ForecastQuestion.`);
  }
  return {
    id: parseNonEmptyString(input.id, `${label}.id`),
    text: parseNonEmptyString(input.text, `${label}.text`),
    eventType: parseOptionalString(input.eventType, `${label}.eventType`),
    geography: parseOptionalString(input.geography, `${label}.geography`),
    referenceClass: parseOptionalString(input.referenceClass, `${label}.referenceClass`),
    assumptions: parseOptionalStringArray(input.assumptions, `${label}.assumptions`),
    tags: parseOptionalStringArray(input.tags, `${label}.tags`),
    prior: input.prior === undefined ? undefined : parseForecastPrior(input.prior, `${label}.prior`)
  };
}

function parseForecastPrior(input: unknown, label: string): ForecastQuestion["prior"] {
  if (!isRecord(input)) {
    throw new Error(`${label} must be an object.`);
  }
  const observedEvents =
    input.observedEvents === undefined ? undefined : parseInteger(input.observedEvents, `${label}.observedEvents`, 0);
  const totalCases = input.totalCases === undefined ? undefined : parseInteger(input.totalCases, `${label}.totalCases`, 1);
  if (observedEvents !== undefined && totalCases !== undefined && observedEvents > totalCases) {
    throw new Error(`${label}.observedEvents must be <= ${label}.totalCases.`);
  }
  return {
    annualProbability:
      input.annualProbability === undefined
        ? undefined
        : parseProbability(input.annualProbability, `${label}.annualProbability`),
    observedEvents,
    totalCases,
    referenceClass: parseOptionalString(input.referenceClass, `${label}.referenceClass`),
    rationale: parseOptionalStringArray(input.rationale, `${label}.rationale`)
  };
}

function parseForecastHorizon(input: unknown, label: string): ForecastHorizon {
  if (!isRecord(input)) {
    throw new Error(`${label} must be a ForecastHorizon.`);
  }
  return {
    label: parseOptionalString(input.label, `${label}.label`),
    months: input.months === undefined ? undefined : parsePositiveNumber(input.months, `${label}.months`),
    startDate: parseOptionalString(input.startDate, `${label}.startDate`),
    endDate: parseOptionalString(input.endDate, `${label}.endDate`)
  };
}

function parseIndicatorArray(input: unknown, label: string): ForecastEvidenceIndicator[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be a ForecastEvidenceIndicator array.`);
  }
  return input.map((indicator, index) => parseForecastIndicator(indicator, `${label}[${index}]`));
}

function parseForecastIndicator(input: unknown, label: string): ForecastEvidenceIndicator {
  if (!isRecord(input)) {
    throw new Error(`${label} must be a ForecastEvidenceIndicator.`);
  }
  return {
    id: parseNonEmptyString(input.id, `${label}.id`),
    label: parseNonEmptyString(input.label, `${label}.label`),
    category: parseIndicatorCategory(input.category, `${label}.category`),
    direction: parseIndicatorDirection(input.direction, `${label}.direction`),
    observed: parseBoolean(input.observed, `${label}.observed`),
    strength: parseProbability(input.strength, `${label}.strength`),
    confidence: parseProbability(input.confidence, `${label}.confidence`),
    weight: input.weight === undefined ? undefined : parsePositiveNumber(input.weight, `${label}.weight`, 0),
    evidence: parseOptionalString(input.evidence, `${label}.evidence`),
    watchTrigger: parseOptionalString(input.watchTrigger, `${label}.watchTrigger`)
  };
}

function parseForecastBaseRate(input: unknown, label: string): ForecastBaseRate {
  if (!isRecord(input)) {
    throw new Error(`${label} must be a ForecastBaseRate.`);
  }
  return {
    questionId: parseNonEmptyString(input.questionId, `${label}.questionId`),
    horizon: parseForecastHorizon(input.horizon, `${label}.horizon`),
    horizonMonths: parsePositiveNumber(input.horizonMonths, `${label}.horizonMonths`),
    referenceClass: parseNonEmptyString(input.referenceClass, `${label}.referenceClass`),
    annualProbability: parseProbability(input.annualProbability, `${label}.annualProbability`),
    probability: parseProbability(input.probability, `${label}.probability`),
    probabilityRange: parseProbabilityRange(input.probabilityRange, `${label}.probabilityRange`),
    observedEvents:
      input.observedEvents === undefined ? undefined : parseInteger(input.observedEvents, `${label}.observedEvents`, 0),
    totalCases: input.totalCases === undefined ? undefined : parseInteger(input.totalCases, `${label}.totalCases`, 1),
    confidence: parseConfidenceLabel(input.confidence, `${label}.confidence`),
    rationale: parseStringArray(input.rationale, `${label}.rationale`)
  };
}

function parseForecastIndicatorAssessment(input: unknown, label: string): ForecastIndicatorAssessment {
  if (!isRecord(input) || !Array.isArray(input.scores)) {
    throw new Error(`${label} must be a ForecastIndicatorAssessment.`);
  }
  return {
    scores: input.scores.map((score, index) => parseForecastIndicatorScore(score, `${label}.scores[${index}]`)),
    netScore: parseScore(input.netScore, `${label}.netScore`),
    supportScore: parseProbability(input.supportScore, `${label}.supportScore`),
    dragScore: parseProbability(input.dragScore, `${label}.dragScore`),
    confidence: parseProbability(input.confidence, `${label}.confidence`),
    rationale: parseStringArray(input.rationale, `${label}.rationale`)
  };
}

function parseForecastIndicatorScore(input: unknown, label: string): ForecastIndicatorScore {
  if (!isRecord(input)) {
    throw new Error(`${label} must be a ForecastIndicatorScore.`);
  }
  return {
    id: parseNonEmptyString(input.id, `${label}.id`),
    label: parseNonEmptyString(input.label, `${label}.label`),
    category: parseIndicatorCategory(input.category, `${label}.category`),
    direction: parseIndicatorDirection(input.direction, `${label}.direction`),
    observed: parseBoolean(input.observed, `${label}.observed`),
    strength: parseProbability(input.strength, `${label}.strength`),
    confidence: parseProbability(input.confidence, `${label}.confidence`),
    weight: parsePositiveNumber(input.weight, `${label}.weight`, 0),
    contribution: parseScore(input.contribution, `${label}.contribution`, -3, 3),
    rationale: parseNonEmptyString(input.rationale, `${label}.rationale`)
  };
}

function parseForecastEstimate(input: unknown, label: string): ForecastEstimate {
  if (!isRecord(input)) {
    throw new Error(`${label} must be a ForecastEstimate.`);
  }
  return {
    question: parseForecastQuestion(input.question, `${label}.question`),
    horizon: parseForecastHorizon(input.horizon, `${label}.horizon`),
    baseRate: parseForecastBaseRate(input.baseRate, `${label}.baseRate`),
    indicatorAssessment: parseForecastIndicatorAssessment(input.indicatorAssessment, `${label}.indicatorAssessment`),
    probability: parseProbability(input.probability, `${label}.probability`),
    probabilityRange: parseProbabilityRange(input.probabilityRange, `${label}.probabilityRange`),
    confidenceBand: {
      ...parseProbabilityRange(input.confidenceBand, `${label}.confidenceBand`),
      label: parseConfidenceLabel(isRecord(input.confidenceBand) ? input.confidenceBand.label : undefined, `${label}.confidenceBand.label`),
      width: parseProbability(isRecord(input.confidenceBand) ? input.confidenceBand.width : undefined, `${label}.confidenceBand.width`)
    },
    adjustment: parseScore(input.adjustment, `${label}.adjustment`, -1, 1),
    rationale: parseStringArray(input.rationale, `${label}.rationale`)
  };
}

function parseProbabilityRange(input: unknown, label: string): { lower: number; upper: number } {
  if (!isRecord(input)) {
    throw new Error(`${label} must be a probability range.`);
  }
  const lower = parseProbability(input.lower, `${label}.lower`);
  const upper = parseProbability(input.upper, `${label}.upper`);
  if (lower > upper) {
    throw new Error(`${label}.lower must be <= ${label}.upper.`);
  }
  return { lower, upper };
}

function parseIndicatorCategory(input: unknown, label: string): ForecastIndicatorCategory {
  if (typeof input === "string" && (INDICATOR_CATEGORIES as readonly string[]).includes(input)) {
    return input as ForecastIndicatorCategory;
  }
  throw new Error(`${label} must be a valid indicator category.`);
}

function parseIndicatorDirection(input: unknown, label: string): ForecastIndicatorDirection {
  if (input === "raises" || input === "lowers") return input;
  throw new Error(`${label} must be "raises" or "lowers".`);
}

function parseConfidenceLabel(input: unknown, label: string): "low" | "medium" | "high" {
  if (input === "low" || input === "medium" || input === "high") return input;
  throw new Error(`${label} must be low, medium, or high.`);
}

function parseStringArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be a string array.`);
  }
  return input.map((item) => parseNonEmptyString(item, label));
}

function parseOptionalStringArray(input: unknown, label: string): string[] | undefined {
  if (input === undefined) return undefined;
  return parseStringArray(input, label);
}

function parseOptionalString(input: unknown, label: string): string | undefined {
  if (input === undefined) return undefined;
  return parseNonEmptyString(input, label);
}

function parseNonEmptyString(input: unknown, label: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return input;
}

function parseBoolean(input: unknown, label: string): boolean {
  if (typeof input !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return input;
}

function parseProbability(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > 1) {
    throw new Error(`${label} must be a number from 0 to 1.`);
  }
  return input;
}

function parseScore(input: unknown, label: string, minimum = -1, maximum = 1): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < minimum || input > maximum) {
    throw new Error(`${label} must be a number from ${minimum} to ${maximum}.`);
  }
  return input;
}

function parsePositiveNumber(input: unknown, label: string, minimum = 0): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= minimum) {
    throw new Error(`${label} must be a number greater than ${minimum}.`);
  }
  return input;
}

function parseInteger(input: unknown, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(input) || (input as number) < minimum || (input as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return input as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
