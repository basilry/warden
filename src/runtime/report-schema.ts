export type SecurityReportConfidence = {
  level: "low" | "medium" | "high";
  rationale: string;
};

export type SecurityReportSection = {
  title: string;
  items: string[];
  kind: "fact" | "inference" | "forecast" | "uncertainty" | "action" | "authority";
};

export type SecurityReport = {
  title: string;
  executiveAnswer: string;
  bottomLine: string[];
  confidence: SecurityReportConfidence;
  facts: SecurityReportSection;
  analysis: SecurityReportSection;
  forecast: SecurityReportSection;
  uncertainty: SecurityReportSection;
  collectionGaps: SecurityReportSection;
  watchIndicators: SecurityReportSection;
  sourceAuthorityRefs: string[];
  warnings: string[];
};
