import type { KnowledgeUnit } from "../../agent/types.ts";
import { scrapeHtmlDocuments } from "./html-scraper.ts";
import type { OsintFetchLike } from "./http-client.ts";
import { runNaturalLanguageOsintSearch } from "./search.ts";
import type {
  OsintProviderTelemetry,
  OsintProviderWarning,
  OsintSearchSourceRegistry
} from "./search-types.ts";
import type { OsintBlockedReason, OsintStoredArtifact } from "./types.ts";

const DEFAULT_DISCOVERY_SCRAPE_CHARS = 5000;

export type OsintDiscoveryRequest = {
  query: string;
  runId: string;
  approvalId: string;
  sourceIds?: string[];
  preferredDomains?: string[];
  maxResults: number;
  timeoutMs: number;
  userAgent: string;
  maxScrapeChars?: number;
};

export type OsintDiscoveryResult = {
  status: "succeeded" | "blocked";
  units: KnowledgeUnit[];
  artifacts: OsintStoredArtifact[];
  warnings: string[];
  providerWarnings?: OsintProviderWarning[];
  providerTelemetry?: OsintProviderTelemetry[];
  discoveredUrls: string[];
  scrapedUrls: string[];
  blockedReason?: OsintBlockedReason | string;
};

export type OsintDiscoveryOptions = {
  fetchImpl?: OsintFetchLike;
  now?: string;
};

export async function runOsintDiscoveryPipeline(
  request: OsintDiscoveryRequest,
  registry: OsintSearchSourceRegistry,
  options: OsintDiscoveryOptions = {}
): Promise<OsintDiscoveryResult> {
  const search = await runNaturalLanguageOsintSearch(request, registry, options);
  if (search.status !== "succeeded") {
    return {
      status: "blocked",
      blockedReason: search.blockedReason ?? "no_results",
      units: [],
      artifacts: search.artifacts,
      warnings: search.warnings,
      providerWarnings: search.providerWarnings,
      providerTelemetry: search.providerTelemetry,
      discoveredUrls: [],
      scrapedUrls: []
    };
  }

  const discoveredUrls = selectDiscoveryUrls(search.units, request.maxResults);
  if (discoveredUrls.length === 0) {
    return {
      status: "succeeded",
      units: search.units.slice(0, request.maxResults),
      artifacts: search.artifacts,
      warnings: [
        ...search.warnings,
        "Source discovery produced no scrapeable URLs; using search summaries as evidence candidates."
      ],
      providerWarnings: search.providerWarnings,
      providerTelemetry: search.providerTelemetry,
      discoveredUrls,
      scrapedUrls: []
    };
  }

  const scrape = await scrapeHtmlDocuments(
    {
      urls: discoveredUrls,
      runId: request.runId,
      approvalId: request.approvalId,
      maxDocuments: Math.max(1, Math.min(request.maxResults, discoveredUrls.length, 10)),
      maxChars: request.maxScrapeChars ?? DEFAULT_DISCOVERY_SCRAPE_CHARS,
      timeoutMs: request.timeoutMs,
      userAgent: request.userAgent
    },
    options
  );
  const scrapedUrls = scrape.status === "succeeded" ? scrape.documents.map((document) => document.canonicalUrl) : [];
  const primaryUnits = scrape.status === "succeeded" && scrape.units.length > 0 ? scrape.units : search.units;

  return {
    status: "succeeded",
    units: primaryUnits.slice(0, request.maxResults),
    artifacts: [...search.artifacts, ...scrape.artifacts],
    warnings: [
      ...search.warnings,
      ...scrape.warnings,
      `Source discovery found ${discoveredUrls.length} URL candidate(s) and scraped ${scrapedUrls.length}.`,
      ...(scrape.status === "succeeded"
        ? ["Scraped page content is unvetted and must pass SourceVet before ACH promotion."]
        : ["HTML scrape produced no usable pages; using search summaries as evidence candidates."])
    ],
    providerWarnings: search.providerWarnings,
    providerTelemetry: search.providerTelemetry,
    discoveredUrls,
    scrapedUrls
  };
}

function selectDiscoveryUrls(units: KnowledgeUnit[], maxResults: number): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    const url = normalizePublicHttpUrl(unit.sourceUri);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= maxResults) break;
  }
  return urls;
}

function normalizePublicHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
