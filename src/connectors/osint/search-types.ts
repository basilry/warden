import type { KnowledgeUnit } from "../../agent/types.ts";
import type { OsintFetchLike } from "./http-client.ts";
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
};

export type OsintSearchSourceRegistry = {
  version: string;
  sources: OsintSearchSource[];
};

export type OsintSearchRequest = {
  query: string;
  runId: string;
  approvalId: string;
  sourceIds?: string[];
  preferredDomains?: string[];
  maxResults: number;
  timeoutMs: number;
  userAgent: string;
};

export type OsintSearchOptions = {
  fetchImpl?: OsintFetchLike;
  now?: string;
};

export type OsintSearchResult = {
  status: "succeeded" | "blocked";
  units: KnowledgeUnit[];
  artifacts: OsintStoredArtifact[];
  warnings: string[];
  blockedReason?: string;
};
