import type { Risk } from "../../agent/types.ts";
import type {
  ForecastBaseRate,
  ForecastEvidenceIndicator,
  ForecastEstimate,
  ForecastHorizon,
  ForecastIndicatorAssessment,
  ForecastQuestion,
  ForecastScenarioSet,
  ForecastWatchlist
} from "../../forecast/index.ts";

export const FORECAST_MCP_TOOL_NAMES = [
  "estimate_base_rate",
  "score_indicators",
  "calculate_forecast",
  "build_scenarios",
  "generate_watchlist"
] as const;

export type ForecastMcpToolName = (typeof FORECAST_MCP_TOOL_NAMES)[number];

export type EstimateBaseRateInput = {
  question: ForecastQuestion;
  horizon: ForecastHorizon;
};

export type EstimateBaseRateOutput = {
  baseRate: ForecastBaseRate;
};

export type ScoreIndicatorsInput = {
  indicators: ForecastEvidenceIndicator[];
};

export type ScoreIndicatorsOutput = {
  indicatorAssessment: ForecastIndicatorAssessment;
};

export type CalculateForecastInput = {
  question: ForecastQuestion;
  horizon: ForecastHorizon;
  baseRate?: ForecastBaseRate;
  indicators?: ForecastEvidenceIndicator[];
  indicatorAssessment?: ForecastIndicatorAssessment;
};

export type CalculateForecastOutput = {
  estimate: ForecastEstimate;
};

export type BuildScenariosInput = CalculateForecastInput & {
  estimate?: ForecastEstimate;
};

export type BuildScenariosOutput = {
  scenarioSet: ForecastScenarioSet;
};

export type GenerateWatchlistInput = {
  question: ForecastQuestion;
  indicators?: ForecastEvidenceIndicator[];
  indicatorAssessment?: ForecastIndicatorAssessment;
  maxItems?: number;
};

export type GenerateWatchlistOutput = {
  watchlist: ForecastWatchlist;
};

export type ForecastMcpInputByTool = {
  estimate_base_rate: EstimateBaseRateInput;
  score_indicators: ScoreIndicatorsInput;
  calculate_forecast: CalculateForecastInput;
  build_scenarios: BuildScenariosInput;
  generate_watchlist: GenerateWatchlistInput;
};

export type ForecastMcpOutputByTool = {
  estimate_base_rate: EstimateBaseRateOutput;
  score_indicators: ScoreIndicatorsOutput;
  calculate_forecast: CalculateForecastOutput;
  build_scenarios: BuildScenariosOutput;
  generate_watchlist: GenerateWatchlistOutput;
};

export function isForecastMcpToolName(value: string): value is ForecastMcpToolName {
  return FORECAST_MCP_TOOL_NAMES.includes(value as ForecastMcpToolName);
}

export function getForecastMcpToolRisk(_toolName: ForecastMcpToolName): Risk {
  return "READ";
}
