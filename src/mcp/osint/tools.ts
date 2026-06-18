import { loadWardenConfig, type WardenConfig } from "../../agent/config.ts";
import { runOsintDiscoveryPipeline } from "../../connectors/osint/discovery.ts";
import { scrapeHtmlDocuments } from "../../connectors/osint/html-scraper.ts";
import type { OsintFetchLike } from "../../connectors/osint/http-client.ts";
import { runNaturalLanguageOsintSearch } from "../../connectors/osint/search.ts";
import { loadOsintSearchSources } from "../../connectors/osint/search-sources.ts";
import type {
  OsintMcpInputByTool,
  OsintMcpOutputByTool,
  OsintMcpToolName,
  ScrapeNewsInput,
  SearchNewsInput
} from "./types.ts";
import { isOsintMcpToolName } from "./types.ts";

const DEFAULT_SCRAPE_MAX_CHARS = 5000;
const MAX_SCRAPE_DOCUMENTS = 10;
const MAX_SCRAPE_CHARS = 50000;

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
  const config = deps.config ?? loadWardenConfig();
  if (name === "search_news") {
    const parsed = parseSearchNewsInput(input);
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

  if (name === "scrape_news") {
    const parsed = parseScrapeNewsInput(input);
    if (!config.osint.liveOptIn) {
      throw new Error("OSINT MCP scrape requires WARDEN_OSINT_LIVE_OPT_IN=true.");
    }
    const maxDocuments = Math.min(parsed.maxDocuments ?? config.osint.maxResults, MAX_SCRAPE_DOCUMENTS);
    const result = await scrapeHtmlDocuments(
      {
        urls: parsed.urls,
        runId: parsed.runId,
        approvalId: parsed.approvalId,
        maxDocuments,
        maxChars: parsed.maxChars ?? DEFAULT_SCRAPE_MAX_CHARS,
        timeoutMs: config.osint.timeoutMs,
        userAgent: config.osint.userAgent
      },
      {
        fetchImpl: deps.fetchImpl,
        now: deps.now
      }
    );
    return { result } as OsintMcpOutputByTool[TName];
  }

  if (name === "discover_news") {
    const parsed = parseDiscoverNewsInput(input);
    if (!config.osint.liveOptIn) {
      throw new Error("OSINT MCP discovery requires WARDEN_OSINT_LIVE_OPT_IN=true.");
    }
    const registry = loadOsintSearchSources(config.osint.searchSourcesPath);
    const result = await runOsintDiscoveryPipeline(
      {
        query: parsed.query,
        runId: parsed.runId,
        approvalId: parsed.approvalId,
        sourceIds: parsed.sourceIds,
        preferredDomains: parsed.preferredDomains,
        maxResults: parsed.maxResults ?? config.osint.maxResults,
        maxScrapeChars: parsed.maxScrapeChars,
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

  throw new Error(`Unsupported OSINT MCP tool: ${String(name)}`);
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

function parseDiscoverNewsInput(input: unknown): SearchNewsInput & { maxScrapeChars?: number } {
  const parsed = parseSearchNewsInput(input);
  if (!isRecord(input)) return parsed;
  return {
    ...parsed,
    maxScrapeChars: input.maxScrapeChars === undefined ? undefined : parseMaxChars(input.maxScrapeChars)
  };
}

function parseScrapeNewsInput(input: unknown): Required<Pick<ScrapeNewsInput, "urls" | "runId" | "approvalId">> &
  Pick<ScrapeNewsInput, "maxDocuments" | "maxChars"> {
  if (!isRecord(input)) {
    throw new Error("scrape_news requires an object input.");
  }
  const runId = parseNonEmptyString(input.runId, "runId");
  const approvalId = parseNonEmptyString(input.approvalId, "approvalId");
  const urls = parseScrapeUrls(input);
  return {
    urls,
    runId,
    approvalId,
    maxDocuments: input.maxDocuments === undefined ? undefined : parseMaxDocuments(input.maxDocuments),
    maxChars: input.maxChars === undefined ? undefined : parseMaxChars(input.maxChars)
  };
}

function parseScrapeUrls(input: Record<string, unknown>): string[] {
  const values: string[] = [];
  if (input.url !== undefined) values.push(parseHttpUrl(input.url, "url"));
  if (input.urls !== undefined) {
    if (!Array.isArray(input.urls)) {
      throw new Error("urls must be a string array.");
    }
    values.push(...input.urls.map((item) => parseHttpUrl(item, "urls")));
  }
  const urls = [...new Set(values)];
  if (urls.length === 0) {
    throw new Error("scrape_news requires url or urls.");
  }
  return urls;
}

function parseHttpUrl(value: unknown, label: string): string {
  const raw = parseNonEmptyString(value, label);
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https.`);
  }
  if (isBlockedNetworkHost(parsed.hostname)) {
    throw new Error(`${label} must not point to localhost or private network addresses.`);
  }
  parsed.hash = "";
  return parsed.toString();
}

function isBlockedNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal") return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host.startsWith("fe80:")) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  const octets = host.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function parseMaxDocuments(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_SCRAPE_DOCUMENTS) {
    throw new Error(`maxDocuments must be an integer from 1 to ${MAX_SCRAPE_DOCUMENTS}.`);
  }
  return value as number;
}

function parseMaxChars(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_SCRAPE_CHARS) {
    throw new Error(`maxChars must be an integer from 1 to ${MAX_SCRAPE_CHARS}.`);
  }
  return value as number;
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
