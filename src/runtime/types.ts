import type { ApprovalRequest } from "../agent/approval.ts";
import type { ModelResponse } from "../agent/model-adapter.ts";
import type { ToolResult } from "../agent/mcp/types.ts";
import type { KnowledgeUnit } from "../agent/types.ts";
import type { RuntimeAnswer, RuntimeAnswerMode } from "./answer.ts";

export type RuntimeDomainGrounding = {
  domain: string;
  confidence: number;
  queryTags: string[];
  evidence: KnowledgeUnit[];
  answerFrame?: {
    id: string;
    intent: string;
    outline: string[];
  };
  limits: string[];
  warnings: string[];
};

export type RuntimeRunStatus = "queued" | "running" | "waiting_approval" | "succeeded" | "failed";

export type RuntimeRunRequest = {
  objective?: string;
  withSourceVet?: boolean;
  answerMode?: RuntimeAnswerMode;
  maxIterations?: number;
};

export type RuntimeEventType =
  | "run.created"
  | "run.started"
  | "loop.iteration"
  | "model.requested"
  | "model.proposal"
  | "domain.grounding"
  | "mcp.tool_start"
  | "mcp.tool_call"
  | "approval.pending"
  | "approval.resolved"
  | "run.resume_ready"
  | "external.fetch_succeeded"
  | "run.succeeded"
  | "run.failed";

export type RuntimeEvent = {
  ts: string;
  runId: string;
  type: RuntimeEventType;
  message: string;
  data?: unknown;
};

export type RuntimeToolRecord = {
  iteration: number;
  toolName: string;
  status: ToolResult["status"];
  error?: string;
  durationMs?: number;
  outputSummary?: string;
};

export type RuntimeRun = {
  id: string;
  objective: string;
  status: RuntimeRunStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  maxIterations: number;
  iteration: number;
  withSourceVet: boolean;
  answerMode: RuntimeAnswerMode;
  events: RuntimeEvent[];
  modelResponses: ModelResponse[];
  toolResults: RuntimeToolRecord[];
  approvals: ApprovalRequest[];
  outputs: {
    teamRunId?: string;
    teamStatus?: string;
    survivors?: string[];
    traceEvents?: number;
    answer?: RuntimeAnswer;
    domainGrounding?: RuntimeDomainGrounding;
    fetchedEvidence?: KnowledgeUnit[];
  };
  error?: string;
};

export type RuntimeState = {
  runs: Map<string, RuntimeRun>;
};
