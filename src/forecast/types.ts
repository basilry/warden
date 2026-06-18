export type ProbabilityRange = {
  lower: number;
  upper: number;
};

export type ForecastQuestion = {
  id: string;
  text: string;
  eventType?: string;
  geography?: string;
  referenceClass?: string;
  assumptions?: string[];
  tags?: string[];
  prior?: {
    annualProbability?: number;
    observedEvents?: number;
    totalCases?: number;
    referenceClass?: string;
    rationale?: string[];
  };
};

export type ForecastHorizon = {
  label?: string;
  months?: number;
  startDate?: string;
  endDate?: string;
};

export type ForecastBaseRate = {
  questionId: string;
  horizon: ForecastHorizon;
  horizonMonths: number;
  referenceClass: string;
  annualProbability: number;
  probability: number;
  probabilityRange: ProbabilityRange;
  observedEvents?: number;
  totalCases?: number;
  confidence: "low" | "medium" | "high";
  rationale: string[];
};

export type ForecastIndicatorCategory =
  | "intent"
  | "capability"
  | "opportunity"
  | "constraint"
  | "military"
  | "diplomatic"
  | "economic"
  | "information"
  | "warning"
  | "other";

export type ForecastIndicatorDirection = "raises" | "lowers";

export type ForecastEvidenceIndicator = {
  id: string;
  label: string;
  category: ForecastIndicatorCategory;
  direction: ForecastIndicatorDirection;
  observed: boolean;
  strength: number;
  confidence: number;
  weight?: number;
  evidence?: string;
  watchTrigger?: string;
};

export type ForecastIndicatorScore = {
  id: string;
  label: string;
  category: ForecastIndicatorCategory;
  direction: ForecastIndicatorDirection;
  observed: boolean;
  strength: number;
  confidence: number;
  weight: number;
  contribution: number;
  rationale: string;
};

export type ForecastIndicatorAssessment = {
  scores: ForecastIndicatorScore[];
  netScore: number;
  supportScore: number;
  dragScore: number;
  confidence: number;
  rationale: string[];
};

export type ForecastConfidenceBand = ProbabilityRange & {
  label: "low" | "medium" | "high";
  width: number;
};

export type ForecastEstimate = {
  question: ForecastQuestion;
  horizon: ForecastHorizon;
  baseRate: ForecastBaseRate;
  indicatorAssessment: ForecastIndicatorAssessment;
  probability: number;
  probabilityRange: ProbabilityRange;
  confidenceBand: ForecastConfidenceBand;
  adjustment: number;
  rationale: string[];
};

export type ForecastScenario = {
  id: string;
  label: string;
  probability: number;
  probabilityRange: ProbabilityRange;
  drivers: string[];
  signposts: string[];
};

export type ForecastScenarioSet = {
  questionId: string;
  horizon: ForecastHorizon;
  scenarios: ForecastScenario[];
  rationale: string[];
};

export type ForecastWatchItem = {
  id: string;
  title: string;
  category: ForecastIndicatorCategory;
  trigger: string;
  direction: ForecastIndicatorDirection;
  urgency: "near_term" | "monitor" | "background";
  linkedIndicatorIds: string[];
  rationale: string;
};

export type ForecastWatchlist = {
  questionId: string;
  items: ForecastWatchItem[];
  text: string;
};
