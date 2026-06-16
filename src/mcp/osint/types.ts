import type { Risk } from "../../agent/types.ts";
import type { HtmlScrapeResult } from "../../connectors/osint/scrape-types.ts";
import type { OsintSearchResult } from "../../connectors/osint/search-types.ts";

export const OSINT_MCP_TOOL_NAMES = ["search_news", "scrape_news"] as const;

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

export type OsintMcpInputByTool = {
  search_news: SearchNewsInput;
  scrape_news: ScrapeNewsInput;
};

export type OsintMcpOutputByTool = {
  search_news: SearchNewsOutput;
  scrape_news: ScrapeNewsOutput;
};

export function isOsintMcpToolName(value: string): value is OsintMcpToolName {
  return OSINT_MCP_TOOL_NAMES.includes(value as OsintMcpToolName);
}

export function getOsintMcpToolRisk(_toolName: OsintMcpToolName): Risk {
  return "EXTERNAL";
}
