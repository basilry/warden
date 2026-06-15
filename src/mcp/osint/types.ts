import type { Risk } from "../../agent/types.ts";
import type { OsintSearchResult } from "../../connectors/osint/search-types.ts";

export const OSINT_MCP_TOOL_NAMES = ["search_news"] as const;

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

export type OsintMcpInputByTool = {
  search_news: SearchNewsInput;
};

export type OsintMcpOutputByTool = {
  search_news: SearchNewsOutput;
};

export function isOsintMcpToolName(value: string): value is OsintMcpToolName {
  return OSINT_MCP_TOOL_NAMES.includes(value as OsintMcpToolName);
}

export function getOsintMcpToolRisk(_toolName: OsintMcpToolName): Risk {
  return "EXTERNAL";
}
