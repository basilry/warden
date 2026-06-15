import type { Claim, KnowledgeUnit, VerificationStatus } from "./types.ts";

export type SourceRiskFlagCode =
  | "missing-reliability"
  | "low-reliability"
  | "weak-claim-confidence"
  | "missing-provenance"
  | "circular-lineage"
  | "independent-corroboration-required"
  | "fixture-source"
  | "report-source"
  | "possible-fabrication";

export type SourceRiskSeverity = "info" | "low" | "medium" | "high" | "critical";

export type SourceRiskFlag = {
  code: SourceRiskFlagCode;
  severity: SourceRiskSeverity;
  summary: string;
  sourceId?: string;
  claimId?: string;
  evidenceRefs: string[];
};

export type SourceRecord = {
  id: string;
  sourceUri: string;
  sourceType: KnowledgeUnit["sourceType"];
  reliability?: string;
  provenance: KnowledgeUnit["provenance"];
  tags: string[];
  claims: Claim[];
};

export type SourceReport = {
  id: string;
  sourceId: string;
  claimId: string;
  text: string;
  normalizedText: string;
  confidence: number;
  evidenceRefs: string[];
  citedSourceIds: string[];
  contentHash: string;
};

export type SourceVetRegistry = {
  sources: SourceRecord[];
  reports: SourceReport[];
};

export type SourceLineageEdge = {
  fromSourceId: string;
  toSourceId: string;
  evidenceRef: string;
};

export type SourceLineageCycle = {
  sourceIds: string[];
  edges: SourceLineageEdge[];
  summary: string;
};

export type SourceCorroborationClaim = {
  claimId: string;
  sourceId: string;
  text: string;
  normalizedText: string;
  independentSourceIds: string[];
  reason: string;
};

export type SourceCorroborationResult = {
  status: VerificationStatus;
  minIndependentSources: number;
  requiredClaims: SourceCorroborationClaim[];
  corroboratedClaims: SourceCorroborationClaim[];
};

export type SourceAssessment = {
  sourceId: string;
  sourceUri: string;
  sourceType: KnowledgeUnit["sourceType"];
  reliability?: string;
  claimCount: number;
  citedSourceIds: string[];
  riskScore: number;
  flags: SourceRiskFlag[];
};

export type SourceReviewStatus = "pass" | "review_required" | "fail";

export type SourceReview = {
  id: string;
  status: SourceReviewStatus;
  sourceCount: number;
  reportCount: number;
  claimCount: number;
  fabricationRisk: number;
  flags: SourceRiskFlag[];
  sourceAssessments: SourceAssessment[];
  independentCorroboration: SourceCorroborationResult;
  circularLineage: SourceLineageCycle[];
  recommendations: string[];
};

export type SourceVetScenario = {
  id: string;
  title: string;
  description: string;
  units: KnowledgeUnit[];
  expected: {
    status: SourceReviewStatus;
    flags: SourceRiskFlagCode[];
  };
};
