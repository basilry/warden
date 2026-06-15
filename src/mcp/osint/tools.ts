import { loadWardenConfig, type WardenConfig } from "../../agent/config.ts";
import type { OsintFetchLike } from "../../connectors/osint/http-client.ts";
import { runNaturalLanguageOsintSearch } from "../../connectors/osint/search.ts";
import { loadOsintSearchSources } from "../../connectors/osint/search-sources.ts";
import type {
  OsintMcpInputByTool,
  OsintMcpOutputByTool,
  OsintMcpToolName,
  SearchNewsInput
} from "./types.ts";
import { isOsintMcpToolName } from "./types.ts";

export type OsintMcpToolDeps = {
  config?: WardenConfig;
  fetchImpl?: OsintFetchLike;
  now?: string;
};

export async function dispatchOsintToolCall<TName extends OsintMcpToolName>(
  name: TName,
  input: OsintMcpInputByTool[TName],
  deps: OsintMcpToolDeps = {}
): Promise<OsintMcpOutputByTool[TName]> {
  if (name !== "search_news") {
    throw new Error(`Unsupported OSINT MCP tool: ${String(name)}`);
  }
  const parsed = parseSearchNewsInput(input);
  const config = deps.config ?? loadWardenConfig();
  if (!config.osint.liveOptIn) {
    throw new Error("OSINT MCP search requires WARDEN_OSINT_LIVE_OPT_IN=true.");
  }
  const registry = loadOsintSearchSources(config.osint.searchSourcesPath);
  const result = await runNaturalLanguageOsintSearch(
    {
      query: parsed.query,
      runId: parsed.runId,
      approvalId: parsed.approvalId,
      sourceIds: parsed.sourceIds,
      preferredDomains: parsed.preferredDomains,
      maxResults: parsed.maxResults ?? config.osint.maxResults,
      timeoutMs: config.osint.timeoutMs,
      userAgent: config.osint.userAgent
    },
    registry,
    {
      fetchImpl: deps.fetchImpl,
      now: deps.now
    }
  );
  return { result } as OsintMcpOutputByTool[TName];
}

export async function dispatchUnknownOsintToolCall(
  name: string,
  input: unknown,
  deps: OsintMcpToolDeps = {}
): Promise<unknown> {
  if (!isOsintMcpToolName(name)) {
    throw new Error(`Unknown OSINT MCP tool: ${name}`);
  }
  return dispatchOsintToolCall(name, input as never, deps);
}

function parseSearchNewsInput(input: unknown): SearchNewsInput {
  if (!isRecord(input)) {
    throw new Error("search_news requires an object input.");
  }
  const query = parseNonEmptyString(input.query, "query");
  const runId = parseNonEmptyString(input.runId, "runId");
  const approvalId = parseNonEmptyString(input.approvalId, "approvalId");
  const maxResults = input.maxResults === undefined ? undefined : parseMaxResults(input.maxResults);
  return {
    query,
    runId,
    approvalId,
    maxResults,
    sourceIds: parseOptionalStringArray(input.sourceIds, "sourceIds"),
    preferredDomains: parseOptionalStringArray(input.preferredDomains, "preferredDomains")
  };
}

function parseMaxResults(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 25) {
    throw new Error("maxResults must be an integer from 1 to 25.");
  }
  return value as number;
}

function parseOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a string array.`);
  }
  return value.map((item) => parseNonEmptyString(item, label));
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
