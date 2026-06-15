import type { SourceReview } from "./sourcevet-types.ts";

export type AgentRole =
  | "supervisor"
  | "case_framer"
  | "evidence_curator"
  | "ach_analyst"
  | "policy_reviewer"
  | "verifier"
  | "briefing"
  | "sourcevet_reviewer"
  | "regression_maintainer";

export type AgentTaskStatus = "queued" | "running" | "blocked" | "succeeded" | "failed";

export type TracePhase =
  | "run_started"
  | "task_created"
  | "task_started"
  | "agent_output"
  | "handoff"
  | "policy_decision"
  | "tool_call"
  | "tool_result"
  | "verification"
  | "brief_created"
  | "run_finished"
  | "failure";

export type Risk = "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL" | "POLICY_CHANGE";

export type PolicyDecision =
  | { decision: "allow"; risk: Risk; reason: string }
  | { decision: "deny"; risk: Risk; reason: string }
  | { decision: "require_approval"; risk: Risk; reason: string };

export type ToolCallPlan = {
  id: string;
  toolName: string;
  capability: string;
  risk: Risk;
  inputSummary: string;
  requestedBy: AgentRole;
};

export type PolicyReviewStatus = "allow" | "blocked" | "approval_required";

export type PolicyReviewReport = {
  status: PolicyReviewStatus;
  decisions: PolicyDecision[];
  blockedCallIds: string[];
  approvalCallIds: string[];
  summary: string;
};

export type ToolAction = {
  name: string;
  capability: string;
  server: "local-ach" | "warden" | "external" | "policy";
  risk?: Risk;
  input?: unknown;
};

export type TraceEvent = {
  ts: string;
  runId: string;
  taskId?: string;
  phase: TracePhase;
  actor: AgentRole | "tool" | "policy" | "system";
  summary: string;
  payloadHash?: string;
  ref?: string;
};

export type TraceSummary = {
  runId: string;
  eventCount: number;
  phases: Record<string, number>;
  policyDecisions: Record<string, number>;
  toolCalls: string[];
  failures: string[];
};

export type TraceRecorder = {
  runId: string;
  record(event: Omit<TraceEvent, "ts" | "runId" | "payloadHash"> & { payload?: unknown }): TraceEvent;
  getEvents(): TraceEvent[];
  summarize(): TraceSummary;
};

export type PolicyEngine = {
  evaluate(action: ToolAction, context: PolicyContext): PolicyDecision;
  assertAllowed(decision: PolicyDecision): void;
};

export type PolicyContext = {
  runId: string;
  taskId?: string;
  role: AgentRole;
  allowWrites?: boolean;
  availableCapabilities?: string[];
};

export type AgentTask = {
  id: string;
  runId: string;
  role: AgentRole;
  goal: string;
  input: unknown;
  status: AgentTaskStatus;
  dependsOn: string[];
  createdAt: string;
  completedAt?: string;
};

export type Handoff = {
  from: AgentRole;
  to: AgentRole;
  taskId: string;
  artifactRefs: string[];
  summary: string;
};

export type TeamPlan = {
  runId: string;
  objective: string;
  tasks: AgentTask[];
};

export type TeamRun = {
  id: string;
  objective: string;
  status: AgentTaskStatus;
  createdAt: string;
  completedAt?: string;
  tasks: AgentTask[];
  handoffs: Handoff[];
};

export type AgentContext = {
  runId: string;
  trace: TraceRecorder;
  policy: PolicyEngine;
  options: RunOptions;
};

export type AgentResult<T = unknown> = {
  status: "succeeded" | "blocked" | "failed";
  output?: T;
  summary: string;
  handoffs?: Handoff[];
  errors?: string[];
  failureClass?: string;
};

export type Agent<I = unknown, O = unknown> = {
  role: AgentRole;
  run(task: AgentTask, context: AgentContext, input: I): Promise<AgentResult<O>>;
};

export type RunOptions = {
  fixtureVariant?:
    | "normal"
    | "missing_reliability"
    | "skip_policy_for_write"
    | "sourcevet_uncorroborated"
    | "sourcevet_circular";
  withSupervisor?: boolean;
  withSourceVet?: boolean;
  withBriefing?: boolean;
  writeArtifacts?: boolean;
  artifactDir?: string;
  extraKnowledgeUnits?: KnowledgeUnit[];
  extraEvidenceBundles?: EvidenceBundle[];
};

export type Verdict = "C" | "I" | "N";

export type CaseFrame = {
  question: string;
  hypotheses: string[];
  nullHypothesis: string;
  domain: "defense_supply_chain";
};

export type Claim = {
  id: string;
  text: string;
  confidence: number;
  evidenceRefs: string[];
};

export type Provenance = {
  capturedBy: "user" | "agent" | "connector";
  originalLocation?: string;
  contentHash: string;
  parserVersion: string;
};

export type KnowledgeUnit = {
  id: string;
  sourceUri: string;
  sourceType: "fixture" | "pdf" | "html" | "api" | "manual" | "report";
  extractedAt: string;
  claims: Claim[];
  provenance: Provenance;
  reliability?: string;
  tags: string[];
};

export type EvidenceBundle = {
  id: string;
  knowledgeUnitId: string;
  text: string;
  source: string;
  reliability: string;
  verdicts: Record<string, Verdict>;
  assumptions: string[];
  unverifiedAreas: string[];
};

export type Hypothesis = {
  id: string;
  text: string;
  isNull: boolean;
};

export type Evidence = {
  id: string;
  text: string;
  source: string;
  reliability: string;
  weight: number;
};

export type MatrixCell = {
  evidenceId: string;
  hypothesisId: string;
  verdict: Verdict;
};

export type HypothesisScore = {
  hypothesisId: string;
  hypothesis: string;
  contradictions: number;
  support: number;
  neutral: number;
  status: "survivor" | "challenged";
};

export type AchCaseRecord = {
  id: string;
  question: string;
  hypotheses: Hypothesis[];
  evidence: Evidence[];
  assessments: MatrixCell[];
};

export type DiagnosticityScore = {
  evidenceId: string;
  evidence: string;
  diagnosticity: number;
  note: string;
};

export type AchAnalysisResult = {
  caseId: string;
  question: string;
  matrix: string;
  ranked: HypothesisScore[];
  diagnosticity: DiagnosticityScore[];
  survivors: string[];
  rfi?: string;
  evidenceBundleIds: string[];
  caseRecord: AchCaseRecord;
};

export type VerificationStatus = "pass" | "fail";

export type VerificationCheck = {
  id: string;
  status: VerificationStatus;
  summary: string;
  failureClass?: string;
};

export type VerificationReport = {
  status: VerificationStatus;
  checks: VerificationCheck[];
  residualRisk: string[];
};

export type AuditBrief = {
  title: string;
  question: string;
  survivorSummary: string;
  rfiSummary?: string;
  agentContributions: { role: AgentRole; summary: string }[];
  verificationSummary: string;
  sourceRiskSummary?: string;
  policyReviewSummary?: string;
  traceSummary: string;
  residualRisk: string[];
};

export type TeamRunResult = {
  run: TeamRun;
  trace: TraceEvent[];
  traceSummary: TraceSummary;
  outputs: {
    caseFrame?: CaseFrame;
    knowledgeUnits?: KnowledgeUnit[];
    evidenceBundles?: EvidenceBundle[];
    sourceReview?: SourceReview;
    policyReview?: PolicyReviewReport;
    ach?: AchAnalysisResult;
    verification?: VerificationReport;
    brief?: AuditBrief;
  };
  markdown?: string;
};

export type RegressionCase = {
  id: string;
  sourceTraceId?: string;
  title: string;
  input: {
    userRequest: string;
    mode?: "p0" | "p1" | "policy" | "security";
    fixtureVariant?: RunOptions["fixtureVariant"];
    policyCalls?: ToolCallPlan[];
    availableCapabilities?: string[];
    securityScenario?: "secret_redaction" | "authority_override" | "raw_tool_call";
  };
  expected: {
    finalStatus: VerificationStatus;
    mustIncludeChecks: string[];
    mustIncludeFailureClass?: string;
  };
  lockedReason: string;
};

export type RegressionResult = {
  id: string;
  status: "passed" | "failed";
  expectedStatus: VerificationStatus;
  actualStatus: VerificationStatus;
  checks: string[];
  failureClasses: string[];
  summary: string;
};
