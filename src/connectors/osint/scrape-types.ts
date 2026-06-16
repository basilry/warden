import type { KnowledgeUnit } from "../../agent/types.ts";
import type { OsintFetchLike } from "./http-client.ts";
import type { OsintStoredArtifact } from "./types.ts";

export type HtmlScrapeLink = {
  url: string;
  text?: string;
};

export type HtmlScrapeDocument = {
  requestedUrl: string;
  canonicalUrl: string;
  title: string;
  textExcerpt: string;
  links: HtmlScrapeLink[];
  status: number;
  capturedAt: string;
  contentHash: string;
  truncated: boolean;
};

export type HtmlScrapeRequest = {
  urls: string[];
  runId: string;
  approvalId: string;
  maxDocuments: number;
  maxChars: number;
  timeoutMs: number;
  userAgent: string;
};

export type HtmlScrapeOptions = {
  fetchImpl?: OsintFetchLike;
  now?: string;
};

export type HtmlScrapeBlockedReason =
  | "config_invalid"
  | "invalid_url"
  | "timeout"
  | "http_error"
  | "malformed_response"
  | "no_results";

export type HtmlScrapeResult = {
  status: "succeeded" | "blocked";
  documents: HtmlScrapeDocument[];
  units: KnowledgeUnit[];
  artifacts: OsintStoredArtifact[];
  sourceVetRequired: true;
  promoteToAch: false;
  warnings: string[];
  blockedReason?: HtmlScrapeBlockedReason;
};
