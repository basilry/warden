import { hashPayload } from "../../agent/ids.ts";
import type { KnowledgeUnit } from "../../agent/types.ts";
import { redactOsintPayload, normalizeOsintResponseToKnowledgeUnits } from "./normalizer.ts";
import type { OsintFetchLike, OsintHttpResponse } from "./http-client.ts";
import { parseRssItems } from "./rss.ts";
import {
  assertSearchEndpointAllowed,
  selectSearchSources
} from "./search-sources.ts";
import {
  createOsintProviderQualityTracker,
  defaultReliabilityForSource,
  OsintProviderFetchError,
  type OsintProviderQualityTracker
} from "./provider-quality.ts";
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
  publisher?: string;
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
  const sources = selectSearchSourcesForQuery(selectSearchSources(registry, { sourceIds: request.sourceIds }), query, request);
  if (sources.length === 0) {
    return blocked("source_not_allowed", "No enabled OSINT search source matched the request.");
  }

  const capturedAt = options.now ?? new Date().toISOString();
  const fetchImpl = options.fetchImpl ?? getGlobalFetch();
  if (!fetchImpl) {
    return blocked("config_invalid", "No fetch implementation is available for OSINT search.");
  }

  const units: KnowledgeUnit[] = [];
  const artifacts: OsintStoredArtifact[] = [];
  const warnings: string[] = [];
  const providerQuality = options.providerQuality ?? createOsintProviderQualityTracker();
  const explicitSources = Boolean(request.sourceIds?.length);

  for (const source of sources) {
    const cooldownWarning = providerQuality.activeCooldown(source);
    if (cooldownWarning) {
      warnings.push(cooldownWarning.message);
      providerQuality.recordCooldownSkip(source, request.runId, cooldownWarning);
      continue;
    }

    const attempt = providerQuality.beginAttempt(source);
    let documents: SearchDocument[];
    try {
      documents = await fetchSearchDocuments(source, request, query, fetchImpl, capturedAt);
      providerQuality.recordSuccess(attempt, request.runId);
    } catch (error) {
      const providerWarning = providerQuality.recordFailure(attempt, request.runId, error);
      warnings.push(providerWarning.message);
      continue;
    }

    if (documents.length === 0) {
      warnings.push(`${source.id}: no matching documents.`);
      continue;
    }

    const payload = { documents };
    artifacts.push(makeArtifact("raw", source.endpoint, capturedAt, { sourceId: source.id, query, payload }));
    artifacts.push(makeArtifact("redacted", source.endpoint, capturedAt, redactOsintPayload(payload)));
    try {
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

    if (!explicitSources && units.length >= request.maxResults) {
      break;
    }
  }

  if (units.length === 0) {
    return {
      status: "blocked",
      blockedReason: "no_results",
      units: [],
      artifacts,
      warnings: warnings.length > 0 ? warnings : ["OSINT search returned no normalizable results."],
      providerWarnings: providerQuality.warnings(),
      providerTelemetry: providerQuality.telemetry()
    };
  }

  return {
    status: "succeeded",
    units: selectDiverseUnits(units, request.maxResults),
    artifacts,
    warnings,
    providerWarnings: providerQuality.warnings(),
    providerTelemetry: providerQuality.telemetry()
  };
}

async function fetchSearchDocuments(
  source: OsintSearchSource,
  request: OsintSearchRequest,
  query: string,
  fetchImpl: OsintFetchLike,
  capturedAt: string
): Promise<SearchDocument[]> {
  const defaultReliability = defaultReliabilityForSource(source);
  if (source.kind === "gdelt-doc") {
    return fetchGdeltDocuments(source, request, query, fetchImpl, capturedAt, defaultReliability);
  }
  if (source.kind === "brave-web") {
    return fetchBraveDocuments(source, request, query, fetchImpl, capturedAt, defaultReliability);
  }
  return fetchRssDocuments(source, request, query, fetchImpl, capturedAt, defaultReliability);
}

async function fetchGdeltDocuments(
  source: OsintSearchSource,
  request: OsintSearchRequest,
  query: string,
  fetchImpl: OsintFetchLike,
  capturedAt: string,
  defaultReliability: string
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
    publisher: readString(article, "domain") ?? source.name,
    reliability: readString(article, "reliability") ?? defaultReliability,
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
  capturedAt: string,
  defaultReliability: string
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
    publisher: source.name,
    reliability: defaultReliability,
    tags: ["brave-web"]
  }));
}

async function fetchRssDocuments(
  source: OsintSearchSource,
  request: OsintSearchRequest,
  query: string,
  fetchImpl: OsintFetchLike,
  capturedAt: string,
  defaultReliability: string
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
      publisher: source.name,
      reliability: defaultReliability,
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
  let response: OsintHttpResponse;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new OsintProviderFetchError("timeout", `OSINT search timed out after ${request.timeoutMs}ms.`));
      }, request.timeoutMs);
    });
    response = await Promise.race([
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
  } catch (error) {
    if (error instanceof OsintProviderFetchError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new OsintProviderFetchError("timeout", `OSINT search timed out after ${request.timeoutMs}ms.`, { cause: error });
    }
    throw new OsintProviderFetchError("http_error", (error as Error).message, { cause: error });
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorKind = response.status === 429 ? "rate_limited" : "http_error";
    throw new OsintProviderFetchError(
      errorKind,
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
      { status: response.status }
    );
  }

  try {
    return {
      status: response.status,
      payload: responseType === "json" ? await readJson(response) : await readText(response)
    };
  } catch (error) {
    throw new OsintProviderFetchError("malformed_response", (error as Error).message, { status: response.status, cause: error });
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

function selectSearchSourcesForQuery(
  sources: OsintSearchSource[],
  query: string,
  request: Pick<OsintSearchRequest, "sourceIds" | "maxResults" | "maxSources">
): OsintSearchSource[] {
  if (request.sourceIds?.length) return sources;
  const budget = Math.max(1, Math.min(sources.length, request.maxSources ?? Math.max(8, request.maxResults + 2)));
  const official = sources.filter((source) => hasTag(source, "official"));
  const global = sources.filter((source) => source.id.includes("global"));
  const international = sources.filter((source) => hasTag(source, "international") && !official.includes(source) && !global.includes(source));
  const korean = sources.filter((source) => hasTag(source, "korea") && !official.includes(source) && !global.includes(source));
  const japan = sources.filter((source) => hasTag(source, "japan") && !official.includes(source) && !global.includes(source));
  const other = sources.filter(
    (source) =>
      !official.includes(source) &&
      !global.includes(source) &&
      !international.includes(source) &&
      !korean.includes(source) &&
      !japan.includes(source)
  );
  const priority = isClaimVerificationQuery(query)
    ? [
        ...official.slice(0, 2),
        ...interleaveSources(global, international, korean, japan, official.slice(2), other)
      ].filter((source): source is OsintSearchSource => Boolean(source))
    : hasHangul(query)
      ? interleaveSources(official, global, korean, international, japan, other)
      : interleaveSources(official, global, international, korean, japan, other);
  return priority.slice(0, budget);
}

function interleaveSources(...groups: OsintSearchSource[][]): OsintSearchSource[] {
  const result: OsintSearchSource[] = [];
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      const source = group[index];
      if (source) result.push(source);
    }
  }
  return result;
}

function hasTag(source: OsintSearchSource, tag: string): boolean {
  return source.tags?.includes(tag) ?? false;
}

function hasHangul(value: string): boolean {
  return /[가-힣]/.test(value);
}

function isClaimVerificationQuery(value: string): boolean {
  return /검증|실제\s*여부|사실\s*여부|fact\s*check|debunk|hoax|conspiracy|음모|허위|가짜/i.test(value);
}

function selectDiverseUnits(units: KnowledgeUnit[], maxResults: number): KnowledgeUnit[] {
  const buckets = new Map<string, KnowledgeUnit[]>();
  for (const unit of units) {
    const key = sourceBucketKey(unit);
    const bucket = buckets.get(key) ?? [];
    bucket.push(unit);
    buckets.set(key, bucket);
  }

  const selected: KnowledgeUnit[] = [];
  while (selected.length < maxResults && buckets.size > 0) {
    for (const key of [...buckets.keys()]) {
      const bucket = buckets.get(key);
      const next = bucket?.shift();
      if (next) selected.push(next);
      if (!bucket || bucket.length === 0) buckets.delete(key);
      if (selected.length >= maxResults) break;
    }
  }
  return selected;
}

function sourceBucketKey(unit: KnowledgeUnit): string {
  const sourceTag = unit.tags.find((tag) => tag.startsWith("source:"));
  if (sourceTag) return sourceTag;
  try {
    return new URL(unit.sourceUri).hostname;
  } catch {
    return unit.sourceType;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getGlobalFetch(): OsintFetchLike | undefined {
  if (typeof globalThis.fetch !== "function") return undefined;
  return globalThis.fetch as unknown as OsintFetchLike;
}
