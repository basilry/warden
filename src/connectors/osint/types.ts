import type { KnowledgeUnit } from "../../agent/types.ts";

export type OsintAllowedSource = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  allowedDomains: string[];
  allowedPaths: string[];
  method?: "GET";
  contentType?: "json";
  tags?: string[];
};

export type OsintAllowlist = {
  version: string;
  sources: OsintAllowedSource[];
};

export type OsintConnectorConfig = {
  liveOptIn: boolean;
  allowlistPath: string;
  timeoutMs: number;
  maxResults: number;
  userAgent: string;
};

export type OsintFetchRequest = {
  query: string;
  approvalId: string;
  runId: string;
  allowedSources?: string[];
  sourceUrls?: string[];
};

export type OsintStoredArtifact = {
  id: string;
  type: "raw" | "redacted";
  sourceUri: string;
  capturedAt: string;
  contentHash: string;
  payload: unknown;
};

export type OsintBlockedReason =
  | "approval_required"
  | "live_opt_in_required"
  | "allowlist_missing"
  | "source_not_allowed"
  | "timeout"
  | "http_error"
  | "malformed_response"
  | "config_invalid";

export type OsintFetchResult = {
  status: "succeeded" | "blocked";
  units: KnowledgeUnit[];
  artifacts: OsintStoredArtifact[];
  sourceVetRequired: true;
  promoteToAch: false;
  warnings: string[];
  blockedReason?: OsintBlockedReason;
};
