import { hashPayload } from "../../agent/ids.ts";
import type { Claim, KnowledgeUnit } from "../../agent/types.ts";
import type { OsintFetchLike, OsintHttpResponse } from "./http-client.ts";
import { redactOsintPayload } from "./normalizer.ts";
import type {
  HtmlScrapeBlockedReason,
  HtmlScrapeDocument,
  HtmlScrapeLink,
  HtmlScrapeOptions,
  HtmlScrapeRequest,
  HtmlScrapeResult
} from "./scrape-types.ts";
import type { OsintStoredArtifact } from "./types.ts";

const MAX_LINKS_PER_DOCUMENT = 20;

export async function scrapeHtmlDocuments(
  request: HtmlScrapeRequest,
  options: HtmlScrapeOptions = {}
): Promise<HtmlScrapeResult> {
  const configError = validateRequest(request);
  if (configError) return blocked("config_invalid", configError);

  let urls: string[];
  try {
    urls = normalizeHttpUrls(request.urls).slice(0, request.maxDocuments);
  } catch (error) {
    return blocked("invalid_url", (error as Error).message);
  }

  const fetchImpl = options.fetchImpl ?? getGlobalFetch();
  if (!fetchImpl) {
    return blocked("config_invalid", "No fetch implementation is available for OSINT HTML scrape.");
  }

  const capturedAt = options.now ?? new Date().toISOString();
  const documents: HtmlScrapeDocument[] = [];
  const units: KnowledgeUnit[] = [];
  const artifacts: OsintStoredArtifact[] = [];
  const warnings: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetchHtml(url, request, fetchImpl);
      const html = await readHtml(response);
      const document = extractHtmlDocument({
        requestedUrl: url,
        status: response.status,
        capturedAt,
        html,
        maxChars: request.maxChars
      });
      documents.push(document);
      units.push(buildKnowledgeUnit(document, request, documents.length - 1));
      artifacts.push(
        makeArtifact("raw", document.canonicalUrl, capturedAt, {
          requestedUrl: url,
          status: response.status,
          htmlExcerpt: truncate(html, request.maxChars),
          truncated: html.length > request.maxChars
        })
      );
      artifacts.push(makeArtifact("redacted", document.canonicalUrl, capturedAt, redactOsintPayload({ document })));
    } catch (error) {
      warnings.push(`${url}: ${(error as Error).message}`);
    }
  }

  if (units.length === 0) {
    return {
      status: "blocked",
      blockedReason: warnings.some((warning) => warning.includes("timed out"))
        ? "timeout"
        : warnings.some((warning) => warning.includes("HTTP "))
          ? "http_error"
          : "no_results",
      documents: [],
      units: [],
      artifacts,
      sourceVetRequired: true,
      promoteToAch: false,
      warnings: warnings.length > 0 ? warnings : ["OSINT HTML scrape returned no normalizable documents."]
    };
  }

  return {
    status: "succeeded",
    documents,
    units,
    artifacts,
    sourceVetRequired: true,
    promoteToAch: false,
    warnings
  };
}

function validateRequest(request: HtmlScrapeRequest): string | undefined {
  if (!Array.isArray(request.urls) || request.urls.length === 0) {
    return "OSINT HTML scrape requires at least one URL.";
  }
  if (!Number.isInteger(request.maxDocuments) || request.maxDocuments < 1 || request.maxDocuments > 10) {
    return "OSINT HTML scrape maxDocuments must be an integer from 1 to 10.";
  }
  if (!Number.isInteger(request.maxChars) || request.maxChars < 1 || request.maxChars > 50000) {
    return "OSINT HTML scrape maxChars must be an integer from 1 to 50000.";
  }
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    return "OSINT HTML scrape timeoutMs must be a positive integer.";
  }
  if (!request.userAgent.trim()) {
    return "OSINT HTML scrape userAgent must be a non-empty string.";
  }
  return undefined;
}

function normalizeHttpUrls(values: string[]): string[] {
  const urls = values.map((value) => normalizeHttpUrl(value));
  return [...new Set(urls)];
}

function normalizeHttpUrl(value: string, base?: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("OSINT HTML scrape URL must be a non-empty string.");
  }
  const parsed = new URL(value.trim(), base);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`OSINT HTML scrape only supports http/https URLs: ${value}`);
  }
  if (isBlockedNetworkHost(parsed.hostname)) {
    throw new Error(`OSINT HTML scrape blocks localhost and private network URLs: ${value}`);
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
  if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

async function fetchHtml(
  url: string,
  request: Pick<HtmlScrapeRequest, "timeoutMs" | "userAgent">,
  fetchImpl: OsintFetchLike
): Promise<OsintHttpResponse> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error(`OSINT HTML scrape timed out after ${request.timeoutMs}ms.`));
      }, request.timeoutMs);
    });
    const response = await Promise.race([
      fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "text/html, application/xhtml+xml, */*",
          "user-agent": request.userAgent
        },
        signal: controller.signal
      }),
      timeoutPromise
    ]);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`);
    }
    return response;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`OSINT HTML scrape timed out after ${request.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readHtml(response: OsintHttpResponse): Promise<string> {
  if (response.text) return response.text();
  if (response.json) return JSON.stringify(await response.json());
  throw new Error("OSINT HTML scrape response did not expose text() or json().");
}

function extractHtmlDocument(input: {
  requestedUrl: string;
  status: number;
  capturedAt: string;
  html: string;
  maxChars: number;
}): HtmlScrapeDocument {
  const canonicalUrl = extractCanonicalUrl(input.html, input.requestedUrl) ?? input.requestedUrl;
  const title = extractTitle(input.html) ?? canonicalUrl;
  const readableText = htmlToText(input.html);
  const textExcerpt = truncate(readableText || title, input.maxChars);
  const links = extractLinks(input.html, canonicalUrl).slice(0, MAX_LINKS_PER_DOCUMENT);
  const contentHash = hashPayload({
    requestedUrl: input.requestedUrl,
    canonicalUrl,
    title,
    textExcerpt,
    links
  });

  return {
    requestedUrl: input.requestedUrl,
    canonicalUrl,
    title,
    textExcerpt,
    links,
    status: input.status,
    capturedAt: input.capturedAt,
    contentHash,
    truncated: readableText.length > input.maxChars
  };
}

function extractTitle(html: string): string | undefined {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? normalizeText(decodeHtmlEntities(stripTags(titleMatch[1]))) : undefined;
  if (title) return title;
  return extractMetaContent(html, ["og:title", "twitter:title"]);
}

function extractCanonicalUrl(html: string, baseUrl: string): string | undefined {
  const linkPattern = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const tag = match[0];
    const rel = readAttribute(tag, "rel")?.toLowerCase();
    if (!rel?.split(/\s+/).includes("canonical")) continue;
    const href = readAttribute(tag, "href");
    if (!href) continue;
    try {
      return normalizeHttpUrl(href, baseUrl);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractMetaContent(html: string, names: string[]): string | undefined {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(metaPattern)) {
    const tag = match[0];
    const key = readAttribute(tag, "property") ?? readAttribute(tag, "name");
    if (!key || !wanted.has(key.toLowerCase())) continue;
    const content = readAttribute(tag, "content");
    const normalized = content ? normalizeText(decodeHtmlEntities(content)) : undefined;
    if (normalized) return normalized;
  }
  return undefined;
}

function extractLinks(html: string, baseUrl: string): HtmlScrapeLink[] {
  const links: HtmlScrapeLink[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"'\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = match[1] ?? match[2] ?? match[3];
    let url: string;
    try {
      url = normalizeHttpUrl(href, baseUrl);
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const text = normalizeText(decodeHtmlEntities(stripTags(match[4] ?? "")));
    links.push({
      url,
      ...(text ? { text: truncate(text, 160) } : {})
    });
    if (links.length >= MAX_LINKS_PER_DOCUMENT) break;
  }
  return links;
}

function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|article|section|tr)>/gi, "\n");
  return normalizeText(decodeHtmlEntities(stripTags(withoutNoise)));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function readAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value ? decodeHtmlEntities(value.trim()) : undefined;
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "...",
    lt: "<",
    mdash: "-",
    nbsp: " ",
    ndash: "-",
    quot: "\""
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => safeCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name.toLowerCase()] ?? entity);
}

function safeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars).trim() : value;
}

function buildKnowledgeUnit(document: HtmlScrapeDocument, request: HtmlScrapeRequest, index: number): KnowledgeUnit {
  const claim = buildClaim(document, index);
  const contentHash = hashPayload({
    document,
    approvalId: request.approvalId,
    runId: request.runId
  });
  return {
    id: `ku_html_scrape_${contentHash.slice(0, 12)}`,
    sourceUri: document.canonicalUrl,
    sourceType: "html",
    extractedAt: document.capturedAt,
    claims: [claim],
    provenance: {
      capturedBy: "connector",
      originalLocation: `${document.requestedUrl}#document-${index + 1}`,
      contentHash,
      parserVersion: "warden-html-scraper/v1"
    },
    reliability: "C3",
    tags: uniqueNonEmpty([
      "live-osint",
      "external-osint",
      "html-scrape",
      "sourcevet-required",
      `approval:${request.approvalId}`
    ]),
    metadata: {
      title: document.title,
      canonicalUrl: document.canonicalUrl,
      summary: document.textExcerpt,
      publishedAt: document.capturedAt,
      publisher: domainFromUrl(document.canonicalUrl),
      requestedUrl: document.requestedUrl,
      truncated: document.truncated
    }
  };
}

function buildClaim(document: HtmlScrapeDocument, index: number): Claim {
  const text = document.textExcerpt || document.title || `Scraped HTML content from ${document.canonicalUrl}.`;
  return {
    id: `claim_html_scrape_${hashPayload({ text, sourceUri: document.canonicalUrl, index }).slice(0, 12)}`,
    text,
    confidence: 0.5,
    evidenceRefs: [`${document.canonicalUrl}#text-excerpt`]
  };
}

function makeArtifact(type: "raw" | "redacted", sourceUri: string, capturedAt: string, payload: unknown): OsintStoredArtifact {
  const contentHash = hashPayload({ type, sourceUri, capturedAt, payload });
  return {
    id: `artifact_html_scrape_${type}_${contentHash.slice(0, 12)}`,
    type,
    sourceUri,
    capturedAt,
    contentHash,
    payload
  };
}

function blocked(blockedReason: HtmlScrapeBlockedReason, warning: string): HtmlScrapeResult {
  return {
    status: "blocked",
    blockedReason,
    documents: [],
    units: [],
    artifacts: [],
    sourceVetRequired: true,
    promoteToAch: false,
    warnings: [warning]
  };
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function domainFromUrl(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value;
  }
}

function getGlobalFetch(): OsintFetchLike | undefined {
  if (typeof globalThis.fetch !== "function") return undefined;
  return globalThis.fetch as unknown as OsintFetchLike;
}
