import type { Risk } from "../../agent/types.ts";
import type { OsintDiscoveryResult } from "../../connectors/osint/discovery.ts";
import type { HtmlScrapeResult } from "../../connectors/osint/scrape-types.ts";
import type { OsintSearchResult } from "../../connectors/osint/search-types.ts";

export const OSINT_MCP_TOOL_NAMES = ["search_news", "scrape_news", "discover_news"] as const;

export type OsintMcpToolName = (typeof OSINT_MCP_TOOL_NAMES)[number];

export type SearchNewsInput = {
  query: string;
  runId: string;
  approvalId: string;
  sourceIds?: string[];
  preferredDomains?: string[];
  maxResults?: number;
};

export type SearchNewsOutput = {
  result: OsintSearchResult;
};

export type ScrapeNewsInput = {
  url?: string;
  urls?: string[];
  runId: string;
  approvalId: string;
  maxDocuments?: number;
  maxChars?: number;
};

export type ScrapeNewsOutput = {
  result: HtmlScrapeResult;
};

export type DiscoverNewsInput = SearchNewsInput & {
  maxScrapeChars?: number;
};

export type DiscoverNewsOutput = {
  result: OsintDiscoveryResult;
};

export type OsintMcpInputByTool = {
  search_news: SearchNewsInput;
  scrape_news: ScrapeNewsInput;
  discover_news: DiscoverNewsInput;
};

export type OsintMcpOutputByTool = {
  search_news: SearchNewsOutput;
  scrape_news: ScrapeNewsOutput;
  discover_news: DiscoverNewsOutput;
};

export function isOsintMcpToolName(value: string): value is OsintMcpToolName {
  return OSINT_MCP_TOOL_NAMES.includes(value as OsintMcpToolName);
}

export function getOsintMcpToolRisk(_toolName: OsintMcpToolName): Risk {
  return "EXTERNAL";
}
