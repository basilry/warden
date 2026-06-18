import type { OsintFetchLike, OsintHttpResponse } from "./http-client.ts";

export type SitemapExtractionOptions = {
  baseUrl?: string;
  allowedDomains?: string[];
  allowedPaths?: string[];
  maxUrls?: number;
};

export type SitemapExtractionResult = {
  urls: string[];
  sitemapUrls: string[];
};

export type FetchSitemapOptions = SitemapExtractionOptions & {
  fetchImpl?: OsintFetchLike;
  userAgent?: string;
  timeoutMs?: number;
};

export type FetchedSitemapUrls = SitemapExtractionResult & {
  sitemapUrl: string;
  status: number;
  text: string;
};

const DEFAULT_USER_AGENT = "warden-osint/1.0";

export function extractSitemapUrls(xml: string, options: SitemapExtractionOptions = {}): SitemapExtractionResult {
  const maxUrls = normalizeMaxUrls(options.maxUrls);
  const allowedDomains = normalizeStringList(options.allowedDomains);
  const allowedPaths = normalizeStringList(options.allowedPaths);

  const urls = extractLocValues(xml, "url")
    .map((value) => normalizeSitemapUrl(value, options.baseUrl))
    .filter((url): url is string => Boolean(url))
    .filter((url) => sitemapUrlAllowed(url, allowedDomains, allowedPaths));

  const sitemapUrls = extractLocValues(xml, "sitemap")
    .map((value) => normalizeSitemapUrl(value, options.baseUrl))
    .filter((url): url is string => Boolean(url))
    .filter((url) => sitemapUrlAllowed(url, allowedDomains, []));

  return {
    urls: unique(urls).slice(0, maxUrls),
    sitemapUrls: unique(sitemapUrls)
  };
}

export async function fetchSitemapUrls(sitemapUrl: string, options: FetchSitemapOptions = {}): Promise<FetchedSitemapUrls> {
  const normalizedSitemapUrl = normalizeSitemapUrl(sitemapUrl);
  if (!normalizedSitemapUrl) {
    throw new Error(`OSINT sitemap URL must use http or https: ${sitemapUrl}`);
  }
  const fetchImpl = options.fetchImpl ?? getGlobalFetch();
  if (!fetchImpl) {
    throw new Error("No fetch implementation is available for OSINT sitemap.");
  }

  const response = await fetchText(normalizedSitemapUrl, fetchImpl, {
    accept: "application/xml, text/xml, */*",
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    timeoutMs: options.timeoutMs,
    label: "OSINT sitemap"
  });
  if (!response.ok) {
    throw new Error(`OSINT sitemap returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`);
  }
  const text = await readTextResponse(response, "OSINT sitemap");
  const extraction = extractSitemapUrls(text, { ...options, baseUrl: options.baseUrl ?? normalizedSitemapUrl });
  return {
    sitemapUrl: normalizedSitemapUrl,
    status: response.status,
    text,
    ...extraction
  };
}

export function canonicalizeSitemapUrl(value: string, baseUrl?: string): string {
  const url = normalizeSitemapUrl(value, baseUrl);
  if (!url) {
    throw new Error(`OSINT sitemap entry must use http or https: ${value}`);
  }
  return url;
}

function extractLocValues(xml: string, parentTag: "url" | "sitemap"): string[] {
  const values: string[] = [];
  const parentPattern = new RegExp(`<(?:[\\w.-]+:)?${parentTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${parentTag}>`, "gi");
  let parentMatch: RegExpExecArray | null;
  while ((parentMatch = parentPattern.exec(xml)) !== null) {
    const loc = extractFirstLoc(parentMatch[1]);
    if (loc) values.push(loc);
  }
  return values;
}

function extractFirstLoc(xml: string): string | undefined {
  const match = /<(?:[\w.-]+:)?loc\b[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/(?:[\w.-]+:)?loc>/i.exec(xml);
  const value = match?.[1] ?? match?.[2];
  return value ? decodeXmlEntities(value).trim() : undefined;
}

function normalizeSitemapUrl(value: string, baseUrl?: string): string | undefined {
  try {
    const url = new URL(value.trim(), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function sitemapUrlAllowed(url: string, allowedDomains: string[], allowedPaths: string[]): boolean {
  if (allowedDomains.length === 0 && allowedPaths.length === 0) return true;
  const parsed = new URL(url);
  const domainAllowed = allowedDomains.length === 0 || allowedDomains.some((domain) => domainMatches(parsed.hostname, domain));
  const pathAllowed = allowedPaths.length === 0 || allowedPaths.some((path) => pathMatches(parsed.pathname, path));
  return domainAllowed && pathAllowed;
}

function domainMatches(hostname: string, allowedDomain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const domain = allowedDomain.toLowerCase().replace(/\.$/, "");
  if (domain.startsWith(".")) {
    const bareDomain = domain.slice(1);
    return host === bareDomain || host.endsWith(domain);
  }
  return host === domain;
}

function pathMatches(pathname: string, allowedPath: string): boolean {
  if (allowedPath === "/") return true;
  if (allowedPath.endsWith("/")) return pathname.startsWith(allowedPath);
  return pathname === allowedPath || pathname.startsWith(`${allowedPath}/`);
}

function normalizeMaxUrls(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(value) || value < 1 || value > 50000) {
    throw new Error("OSINT sitemap maxUrls must be an integer from 1 to 50000.");
  }
  return value;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => safeCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function safeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

async function fetchText(
  url: string,
  fetchImpl: OsintFetchLike,
  options: { accept: string; userAgent: string; timeoutMs?: number; label: string }
): Promise<OsintHttpResponse> {
  if (options.timeoutMs === undefined) {
    return fetchImpl(url, {
      method: "GET",
      headers: {
        accept: options.accept,
        "user-agent": options.userAgent
      }
    });
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`${options.label} timeoutMs must be a positive integer.`);
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error(`${options.label} timed out after ${options.timeoutMs}ms.`));
      }, options.timeoutMs);
    });
    return await Promise.race([
      fetchImpl(url, {
        method: "GET",
        headers: {
          accept: options.accept,
          "user-agent": options.userAgent
        },
        signal: controller.signal
      }),
      timeoutPromise
    ]);
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`${options.label} timed out after ${options.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readTextResponse(response: OsintHttpResponse, label: string): Promise<string> {
  if (response.text) return response.text();
  if (response.json) return JSON.stringify(await response.json());
  throw new Error(`${label} response did not expose text() or json().`);
}

function getGlobalFetch(): OsintFetchLike | undefined {
  if (typeof globalThis.fetch !== "function") return undefined;
  return globalThis.fetch as unknown as OsintFetchLike;
}
