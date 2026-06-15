import { hashPayload } from "../../agent/ids.ts";
import { redactOsintPayload, normalizeOsintResponseToKnowledgeUnits } from "./normalizer.ts";
import type { OsintFetchLike, OsintHttpResponse } from "./http-client.ts";
import { parseRssItems } from "./rss.ts";
import {
  assertSearchEndpointAllowed,
  selectSearchSources
} from "./search-sources.ts";
import type {
  OsintSearchOptions,
  OsintSearchRequest,
  OsintSearchResult,
  OsintSearchSource,
  OsintSearchSourceRegistry
} from "./search-types.ts";
import type { OsintStoredArtifact } from "./types.ts";

type SearchDocument = {
  title: string;
  url: string;
  summary?: string;
  publishedAt?: string;
  reliability?: string;
  tags?: string[];
};

type FetchResponse = {
  status: number;
  payload: unknown;
};

export async function runNaturalLanguageOsintSearch(
  request: OsintSearchRequest,
  registry: OsintSearchSourceRegistry,
  options: OsintSearchOptions = {}
): Promise<OsintSearchResult> {
  const query = normalizeQuery(request.query);
  const sources = selectSearchSources(registry, { sourceIds: request.sourceIds });
  if (sources.length === 0) {
    return blocked("source_not_allowed", "No enabled OSINT search source matched the request.");
  }

  const capturedAt = options.now ?? new Date().toISOString();
  const fetchImpl = options.fetchImpl ?? getGlobalFetch();
  if (!fetchImpl) {
    return blocked("config_invalid", "No fetch implementation is available for OSINT search.");
  }

  const units = [];
  const artifacts: OsintStoredArtifact[] = [];
  const warnings: string[] = [];

  for (const source of sources) {
    try {
      const documents = await fetchSearchDocuments(source, request, query, fetchImpl, capturedAt);
      if (documents.length === 0) {
        warnings.push(`${source.id}: no matching documents.`);
        continue;
      }
      const payload = { documents };
      artifacts.push(makeArtifact("raw", source.endpoint, capturedAt, { sourceId: source.id, query, payload }));
      artifacts.push(makeArtifact("redacted", source.endpoint, capturedAt, redactOsintPayload(payload)));
      units.push(
        ...normalizeOsintResponseToKnowledgeUnits(
          payload,
          {
            sourceUri: source.endpoint,
            sourceId: source.id,
            approvalId: request.approvalId,
            runId: request.runId,
            capturedAt,
            tags: uniqueNonEmpty(["natural-language-search", ...domainTags(request.preferredDomains), ...(source.tags ?? [])])
          },
          { maxResults: request.maxResults }
        )
      );
    } catch (error) {
      warnings.push(`${source.id}: ${(error as Error).message}`);
    }

    if (units.length >= request.maxResults) break;
  }

  if (units.length === 0) {
    return {
      status: "blocked",
      blockedReason: "no_results",
      units: [],
      artifacts,
      warnings: warnings.length > 0 ? warnings : ["OSINT search returned no normalizable results."]
    };
  }

  return {
    status: "succeeded",
    units: units.slice(0, request.maxResults),
    artifacts,
    warnings
  };
}

async function fetchSearchDocuments(
  source: OsintSearchSource,
  request: OsintSearchRequest,
  query: string,
  fetchImpl: OsintFetchLike,
  capturedAt: string
): Promise<SearchDocument[]> {
  if (source.kind === "gdelt-doc") {
    return fetchGdeltDocuments(source, request, query, fetchImpl, capturedAt);
  }
  if (source.kind === "brave-web") {
    return fetchBraveDocuments(source, request, query, fetchImpl, capturedAt);
  }
  return fetchRssDocuments(source, request, query, fetchImpl, capturedAt);
}

async function fetchGdeltDocuments(
  source: OsintSearchSource,
  request: OsintSearchRequest,
  query: string,
  fetchImpl: OsintFetchLike,
  capturedAt: string
): Promise<SearchDocument[]> {
  const endpoint = assertSearchEndpointAllowed(source);
  endpoint.searchParams.set("query", buildQuery(source, query, request.preferredDomains, "gdelt-doc"));
  endpoint.searchParams.set("mode", endpoint.searchParams.get("mode") ?? "ArtList");
  endpoint.searchParams.set("format", endpoint.searchParams.get("format") ?? "json");
  endpoint.searchParams.set("sort", endpoint.searchParams.get("sort") ?? "HybridRel");
  endpoint.searchParams.set("maxrecords", String(Math.max(1, Math.min(request.maxResults, 25))));

  const response = await fetchPayload(endpoint.toString(), request, fetchImpl, "json");
  const articles = parseArticleArray(response.payload, ["articles"]);
  return articles.map((article, index) => ({
    title: readString(article, "title") ?? `GDELT result ${index + 1}`,
    url: readString(article, "url") ?? endpoint.toString(),
    summary: readString(article, "title") ?? readString(article, "description") ?? "GDELT article search result.",
    publishedAt: parseGdeltSeenDate(readString(article, "seendate")) ?? capturedAt,
    reliability: readString(article, "reliability") ?? "C3",
    tags: uniqueNonEmpty([
      "gdelt-doc",
      readString(article, "domain") ? `domain:${readString(article, "domain")}` : undefined,
      readString(article, "sourceCountry") ? `country:${readString(article, "sourceCountry")}` : undefined,
      readString(article, "language") ? `language:${readString(article, "language")}` : undefined
    ])
  }));
}

async function fetchBraveDocuments(
  source: OsintSearchSource,
  request: OsintSearchRequest,
  query: string,
  fetchImpl: OsintFetchLike,
  capturedAt: string
): Promise<SearchDocument[]> {
  const apiKey = source.apiKeyEnv ? process.env[source.apiKeyEnv] : undefined;
  if (source.apiKeyEnv && !apiKey) {
    throw new Error(`${source.apiKeyEnv} is not configured.`);
  }
  const endpoint = assertSearchEndpointAllowed(source);
  endpoint.searchParams.set("q", buildQuery(source, query, request.preferredDomains, "brave-web"));
  endpoint.searchParams.set("count", String(Math.max(1, Math.min(request.maxResults, 20))));
  if (source.defaultFreshness) endpoint.searchParams.set("freshness", source.defaultFreshness);

  const response = await fetchPayload(endpoint.toString(), request, fetchImpl, "json", {
    ...(apiKey ? { "x-subscription-token": apiKey } : {})
  });
  const results = readRecord(response.payload, "web")?.results;
  const articles = Array.isArray(results) ? results.filter(isRecord) : [];
  return articles.map((article, index) => ({
    title: readString(article, "title") ?? `Brave result ${index + 1}`,
    url: readString(article, "url") ?? endpoint.toString(),
    summary: readString(article, "description") ?? readString(article, "title") ?? "Brave web search result.",
    publishedAt: capturedAt,
    reliability: "C3",
    tags: ["brave-web"]
  }));
}

async function fetchRssDocuments(
  source: OsintSearchSource,
  request: OsintSearchRequest,
  query: string,
  fetchImpl: OsintFetchLike,
  capturedAt: string
): Promise<SearchDocument[]> {
  const endpoint = assertSearchEndpointAllowed(source);
  const response = await fetchPayload(endpoint.toString(), request, fetchImpl, "text");
  const tokens = queryTokens(query);
  return parseRssItems(String(response.payload))
    .filter((item) => tokens.length === 0 || tokens.some((token) => `${item.title} ${item.description}`.toLowerCase().includes(token)))
    .slice(0, request.maxResults)
    .map((item) => ({
      title: item.title,
      url: item.link || endpoint.toString(),
      summary: item.description,
      publishedAt: parseDate(item.pubDate) ?? capturedAt,
      reliability: "C3",
      tags: ["rss"]
    }));
}

async function fetchPayload(
  url: string,
  request: Pick<OsintSearchRequest, "timeoutMs" | "userAgent">,
  fetchImpl: OsintFetchLike,
  responseType: "json" | "text",
  headers: Record<string, string> = {}
): Promise<FetchResponse> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error(`OSINT search timed out after ${request.timeoutMs}ms.`));
      }, request.timeoutMs);
    });
    const response = await Promise.race([
      fetchImpl(url, {
        method: "GET",
        headers: {
          accept: responseType === "json" ? "application/json" : "application/rss+xml, application/xml, text/xml, */*",
          "user-agent": request.userAgent,
          ...headers
        },
        signal: controller.signal
      }),
      timeoutPromise
    ]);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`);
    }
    return {
      status: response.status,
      payload: responseType === "json" ? await readJson(response) : await readText(response)
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readJson(response: OsintHttpResponse): Promise<unknown> {
  if (response.json) return response.json();
  if (response.text) return JSON.parse(await response.text()) as unknown;
  throw new Error("Search response did not expose json() or text().");
}

async function readText(response: OsintHttpResponse): Promise<string> {
  if (response.text) return response.text();
  if (response.json) return JSON.stringify(await response.json());
  throw new Error("Search response did not expose text() or json().");
}

function buildQuery(
  source: OsintSearchSource,
  query: string,
  preferredDomains: string[] | undefined,
  provider: "gdelt-doc" | "brave-web"
): string {
  const domains = uniqueNonEmpty(preferredDomains ?? []);
  const domainQuery =
    domains.length === 0
      ? undefined
      : provider === "brave-web"
        ? `(${domains.map((domain) => `site:${domain}`).join(" OR ")})`
        : `(${domains.map((domain) => `domain:${domain}`).join(" OR ")})`;
  return uniqueNonEmpty([source.queryPrefix, query, domainQuery, source.querySuffix]).join(" ");
}

function parseArticleArray(payload: unknown, keys: string[]): Record<string, unknown>[] {
  if (!isRecord(payload)) return [];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function normalizeQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("OSINT search requires a non-empty query.");
  if (/^https?:\/\//i.test(normalized)) throw new Error("OSINT search accepts natural language queries, not direct URLs.");
  return normalized;
}

function queryTokens(query: string): string[] {
  return uniqueNonEmpty(
    query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  ).slice(0, 12);
}

function parseGdeltSeenDate(value: string | undefined): string | undefined {
  if (!value || value.length < 14) return undefined;
  const parsed = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
  return parseDate(parsed);
}

function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function makeArtifact(type: "raw" | "redacted", sourceUri: string, capturedAt: string, payload: unknown): OsintStoredArtifact {
  const contentHash = hashPayload({ type, sourceUri, capturedAt, payload });
  return {
    id: `artifact_osint_search_${type}_${contentHash.slice(0, 12)}`,
    type,
    sourceUri,
    capturedAt,
    contentHash,
    payload
  };
}

function blocked(blockedReason: string, warning: string): OsintSearchResult {
  return {
    status: "blocked",
    blockedReason,
    units: [],
    artifacts: [],
    warnings: [warning]
  };
}

function domainTags(domains: string[] | undefined): string[] {
  return (domains ?? []).map((domain) => `preferred-domain:${domain}`);
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getGlobalFetch(): OsintFetchLike | undefined {
  if (typeof globalThis.fetch !== "function") return undefined;
  return globalThis.fetch as unknown as OsintFetchLike;
}
