import { dispatchForecastToolCall, dispatchUnknownForecastToolCall } from "../src/mcp/forecast/tools.ts";
import type { ForecastEvidenceIndicator, ForecastHorizon, ForecastQuestion } from "../src/forecast/index.ts";

const question: ForecastQuestion = {
  id: "forecast_taiwan_invasion_like_2027",
  text: "Will the PRC initiate a large-scale amphibious or airborne invasion attempt against Taiwan within the next 12 months?",
  eventType: "cross_strait_invasion",
  geography: "Taiwan Strait",
  referenceClass: "post-1945 cross-strait and major-state amphibious invasion attempts",
  assumptions: [
    "Forecast event requires a large-scale attempt to seize territory, not gray-zone pressure or blockade alone.",
    "Evidence is a deterministic regression fixture, not live intelligence."
  ],
  prior: {
    annualProbability: 0.06,
    observedEvents: 2,
    totalCases: 32,
    referenceClass: "rare major-power amphibious invasion attempts under deterrence",
    rationale: ["Fixture prior keeps the base rate low because invasion is costly and operationally visible."]
  },
  tags: ["forecast", "taiwan", "geopolitics", "p24"]
};

const horizon: ForecastHorizon = {
  label: "next 12 months",
  months: 12,
  startDate: "2026-06-18",
  endDate: "2027-06-18"
};

const indicators: ForecastEvidenceIndicator[] = [
  {
    id: "no_large_amphibious_staging",
    label: "No reliable large-scale amphibious staging observed",
    category: "military",
    direction: "lowers",
    observed: true,
    strength: 0.85,
    confidence: 0.8,
    weight: 1.4,
    evidence: "Fixture evidence keeps exercise activity below irreversible loading and embarkation patterns.",
    watchTrigger: "Confirmed mass sealift loading, field hospitals, fuel distribution, and embarkation orders."
  },
  {
    id: "joint_fire_rehearsals",
    label: "Sustained joint-fire and blockade rehearsals",
    category: "military",
    direction: "raises",
    observed: true,
    strength: 0.7,
    confidence: 0.7,
    weight: 1,
    evidence: "Exercises rehearse blockade and strike options but remain reversible.",
    watchTrigger: "Exercises extend into persistent exclusion zones with combat logistics attached."
  },
  {
    id: "logistics_stockpiling",
    label: "Logistics stockpiling and transport readiness signals",
    category: "capability",
    direction: "raises",
    observed: true,
    strength: 0.65,
    confidence: 0.65,
    weight: 0.9,
    evidence: "Procurement and transport readiness signals suggest planning pressure.",
    watchTrigger: "Corroborated civilian roll-on/roll-off requisitioning or sustained forward fuel movement."
  },
  {
    id: "no_civil_mobilization",
    label: "No reliable civil defense or medical mobilization order",
    category: "warning",
    direction: "lowers",
    observed: true,
    strength: 0.8,
    confidence: 0.75,
    weight: 1.1,
    evidence: "Fixture evidence does not show nationwide civil mobilization.",
    watchTrigger: "Nationwide medical, blood supply, reserve, or transport mobilization order becomes public or corroborated."
  },
  {
    id: "leadership_deadline_rhetoric",
    label: "Leadership rhetoric raises reunification priority",
    category: "intent",
    direction: "raises",
    observed: true,
    strength: 0.55,
    confidence: 0.55,
    weight: 0.7,
    evidence: "Political rhetoric increases pressure but is less diagnostic than mobilization.",
    watchTrigger: "Rhetoric shifts from long-run priority to explicit near-term operational deadline."
  },
  {
    id: "deterrence_cost_signals",
    label: "Allied deterrence posture and economic cost signals remain strong",
    category: "constraint",
    direction: "lowers",
    observed: true,
    strength: 0.7,
    confidence: 0.7,
    weight: 1,
    evidence: "Allied posture and expected economic costs continue to constrain action.",
    watchTrigger: "Allied posture weakens materially or sanctions-cost expectations fall."
  }
];

const baseRateOutput = dispatchForecastToolCall("estimate_base_rate", { question, horizon });
const indicatorOutput = dispatchForecastToolCall("score_indicators", { indicators });
const forecastOutput = dispatchForecastToolCall("calculate_forecast", {
  question,
  horizon,
  baseRate: baseRateOutput.baseRate,
  indicatorAssessment: indicatorOutput.indicatorAssessment
});
const scenarioOutput = dispatchForecastToolCall("build_scenarios", {
  question,
  horizon,
  estimate: forecastOutput.estimate
});
const watchlistOutput = dispatchForecastToolCall("generate_watchlist", {
  question,
  indicators,
  indicatorAssessment: indicatorOutput.indicatorAssessment,
  maxItems: 6
});

assertEqual(baseRateOutput.baseRate.referenceClass, question.prior?.referenceClass, "base-rate reference class");
assertEqual(indicatorOutput.indicatorAssessment.scores.length, indicators.length, "indicator score count");
assertBetween(forecastOutput.estimate.probability, 0.02, 0.2, "forecast probability");
assertOrderedRange(forecastOutput.estimate.probabilityRange, "forecast probability range");
assertOrderedRange(forecastOutput.estimate.confidenceBand, "forecast confidence band");
assertEqual(scenarioOutput.scenarioSet.scenarios.length, 3, "scenario count");
assertAtLeast(watchlistOutput.watchlist.items.length, 4, "watchlist item count");
assertThrows(() => dispatchUnknownForecastToolCall("unknown_forecast_tool", {}), "unknown tool guard");

console.log("WARDEN forecast regression: passed");
console.log(`Question: ${question.text}`);
console.log(`Base rate: ${formatPercent(baseRateOutput.baseRate.probability)} over ${baseRateOutput.baseRate.horizonMonths} months`);
console.log(`Indicator score: ${indicatorOutput.indicatorAssessment.netScore}`);
console.log(`Point estimate: ${formatPercent(forecastOutput.estimate.probability)}`);
console.log(`Probability range: ${formatRange(forecastOutput.estimate.probabilityRange)}`);
console.log(
  `Confidence band: ${formatRange(forecastOutput.estimate.confidenceBand)} (${forecastOutput.estimate.confidenceBand.label})`
);
console.log("Scenarios:");
for (const scenario of scenarioOutput.scenarioSet.scenarios) {
  console.log(`- ${scenario.label}: ${formatPercent(scenario.probability)} (${formatRange(scenario.probabilityRange)})`);
}
console.log("Watch indicators:");
console.log(watchlistOutput.watchlist.text);

function assertBetween(actual: number, minimum: number, maximum: number, label: string): void {
  if (actual < minimum || actual > maximum) {
    throw new Error(`${label} failed: expected ${minimum} <= ${actual} <= ${maximum}`);
  }
}

function assertAtLeast(actual: number, minimum: number, label: string): void {
  if (actual < minimum) {
    throw new Error(`${label} failed: expected >= ${minimum} actual=${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function assertOrderedRange(range: { lower: number; upper: number }, label: string): void {
  if (range.lower <= 0 || range.upper <= range.lower || range.upper > 1) {
    throw new Error(`${label} failed: invalid range ${JSON.stringify(range)}`);
  }
}

function assertThrows(fn: () => unknown, label: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label}: expected throw`);
}

function formatRange(range: { lower: number; upper: number }): string {
  return `${formatPercent(range.lower)}-${formatPercent(range.upper)}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10_000) / 100}%`;
}
