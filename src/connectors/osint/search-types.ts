import type { KnowledgeUnit } from "../../agent/types.ts";
import type { OsintFetchLike } from "./http-client.ts";
import type { OsintProviderQualityTracker } from "./provider-quality.ts";
import type { OsintStoredArtifact } from "./types.ts";

export type OsintSearchSourceKind = "gdelt-doc" | "brave-web" | "rss";

export type OsintSearchSource = {
  id: string;
  name: string;
  kind: OsintSearchSourceKind;
  enabled: boolean;
  endpoint: string;
  allowedDomains: string[];
  allowedPaths: string[];
  tags?: string[];
  apiKeyEnv?: string;
  queryPrefix?: string;
  querySuffix?: string;
  defaultFreshness?: "pd" | "pw" | "pm" | "py";
  reliability?: string;
  rateLimitKey?: string;
  cooldownMs?: number;
  backoffMultiplier?: number;
};

export type OsintSearchSourceRegistry = {
  version: string;
  sources: OsintSearchSource[];
};

export type OsintProviderErrorKind =
  | "rate_limited"
  | "timeout"
  | "http_error"
  | "config_invalid"
  | "malformed_response"
  | "unknown";

export type OsintProviderWarningKind = OsintProviderErrorKind | "cooldown";

export type OsintProviderWarning = {
  sourceId: string;
  sourceKind: OsintSearchSourceKind;
  kind: OsintProviderWarningKind;
  message: string;
  status?: number;
  cooldownUntil?: string;
};

export type OsintProviderTelemetry = {
  runId: string;
  sourceId: string;
  sourceKind: OsintSearchSourceKind;
  attempted: boolean;
  failed: boolean;
  latencyMs: number;
  errorKind?: OsintProviderErrorKind;
  status?: number;
  failureCount?: number;
  cooldownMs?: number;
  cooldownUntil?: string;
  message?: string;
};

export type OsintSearchRequest = {
  query: string;
  runId: string;
  approvalId: string;
  sourceIds?: string[];
  preferredDomains?: string[];
  maxResults: number;
  maxSources?: number;
  timeoutMs: number;
  userAgent: string;
};

export type OsintSearchOptions = {
  fetchImpl?: OsintFetchLike;
  now?: string;
  providerQuality?: OsintProviderQualityTracker;
};

export type OsintSearchResult = {
  status: "succeeded" | "blocked";
  units: KnowledgeUnit[];
  artifacts: OsintStoredArtifact[];
  warnings: string[];
  providerWarnings?: OsintProviderWarning[];
  providerTelemetry?: OsintProviderTelemetry[];
  blockedReason?: string;
};
