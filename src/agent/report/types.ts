import type { ApprovalRequest } from "../approval.ts";
import type { P1RunResult } from "../p1-runner.ts";
import type { RegressionResult, TeamRunResult, TraceEvent } from "../types.ts";

export type ReportStatus = "pass" | "warn" | "fail" | "blocked";

export type WardenReportInput = {
  teamResult: TeamRunResult;
  p1Result?: P1RunResult;
  regressionResults?: RegressionResult[];
  generatedAt?: string;
};

export type ReportArtifact = {
  reportId: string;
  runId: string;
  outputDir: string;
  htmlPath: string;
};

export type WardenReport = {
  reportId: string;
  runId: string;
  generatedAt: string;
  title: string;
  status: ReportStatus;
  casePanel: CasePanel;
  jobPanel?: JobPanel;
  achPanel: AchPanel;
  sourceVetPanel?: SourceVetPanel;
  policyPanel: PolicyPanel;
  approvalPanel: ApprovalPanel;
  tracePanel: TracePanel;
  regressionPanel?: RegressionPanel;
  residualRisk: string[];
};

export type CasePanel = {
  runId: string;
  objective: string;
  runStatus: string;
  createdAt: string;
  completedAt?: string;
  question?: string;
  verificationStatus?: string;
};

export type JobPanel = {
  jobId: string;
  status: string;
  history: { status: string; summary: string; ref?: string; at: string }[];
  toolCatalog: string[];
  knowledgeSummary: string[];
};

export type AchPanel = {
  caseId?: string;
  survivors: string[];
  ranking: {
    hypothesis: string;
    contradictions: number;
    support: number;
    neutral: number;
    status: string;
  }[];
  diagnosticity: { evidence: string; diagnosticity: number; note: string }[];
  matrixRows: string[][];
  rfi?: string;
};

export type SourceVetPanel = {
  status: string;
  sourceCount: number;
  claimCount: number;
  fabricationRisk: number;
  flags: {
    code: string;
    severity: string;
    summary: string;
    sourceId?: string;
  }[];
  recommendations: string[];
};

export type PolicyPanel = {
  status?: string;
  summary?: string;
  decisions: {
    ref?: string;
    summary: string;
    ts: string;
  }[];
  counts: Record<string, number>;
};

export type ApprovalPanel = {
  pendingCount: number;
  approvals: ApprovalRequest[];
};

export type TracePanel = {
  eventCount: number;
  toolCalls: string[];
  failures: string[];
  events: TraceEvent[];
};

export type RegressionPanel = {
  total: number;
  passed: number;
  results: RegressionResult[];
};

