import { readFileSync } from "node:fs";
import type { OsintAllowedSource, OsintAllowlist } from "./types.ts";

export const DEFAULT_OSINT_ALLOWLIST_PATH = "fixtures/osint/allowlist.json";

export type SourceAllowedCheck = {
  source: OsintAllowedSource;
  url: URL;
};

export function loadOsintAllowlist(path = DEFAULT_OSINT_ALLOWLIST_PATH): OsintAllowlist {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parseOsintAllowlist(parsed, path);
}

export function parseOsintAllowlist(value: unknown, origin = "inline"): OsintAllowlist {
  if (!isRecord(value)) {
    throw new Error(`OSINT allowlist ${origin} must be an object.`);
  }
  const version = typeof value.version === "string" && value.version.trim() ? value.version.trim() : "v1";
  if (!Array.isArray(value.sources)) {
    throw new Error(`OSINT allowlist ${origin} must include a sources array.`);
  }
  const sources = value.sources.map((source, index) => parseAllowedSource(source, `${origin}:sources[${index}]`));
  return { version, sources };
}

export function assertSourceAllowed(
  sourceUrl: string,
  allowlist: OsintAllowlist,
  options: { sourceIds?: string[] } = {}
): SourceAllowedCheck {
  const url = parseSafeUrl(sourceUrl);
  const matchingSource = allowlist.sources.find((source) => {
    if (!source.enabled) return false;
    if (options.sourceIds?.length && !options.sourceIds.includes(source.id)) return false;
    return isUrlAllowedBySource(url, source);
  });
  if (!matchingSource) {
    throw new Error(`OSINT source is not allowlisted: ${redactUrlForMessage(url)}`);
  }
  return { source: matchingSource, url };
}

export function isSourceAllowed(
  sourceUrl: string,
  allowlist: OsintAllowlist,
  options: { sourceIds?: string[] } = {}
): boolean {
  try {
    assertSourceAllowed(sourceUrl, allowlist, options);
    return true;
  } catch {
    return false;
  }
}

export function selectAllowlistedSourceUrls(
  allowlist: OsintAllowlist,
  options: { sourceIds?: string[]; sourceUrls?: string[] } = {}
): string[] {
  const sourceIds = normalizeStringArray(options.sourceIds);
  const sourceUrls = normalizeStringArray(options.sourceUrls);

  if (sourceUrls.length > 0) {
    return sourceUrls.map((url) => assertSourceAllowed(url, allowlist, { sourceIds }).url.toString());
  }

  return allowlist.sources
    .filter((source) => source.enabled)
    .filter((source) => sourceIds.length === 0 || sourceIds.includes(source.id))
    .map((source) => assertSourceAllowed(source.url, allowlist, { sourceIds }).url.toString());
}

function parseAllowedSource(value: unknown, origin: string): OsintAllowedSource {
  if (!isRecord(value)) {
    throw new Error(`OSINT source ${origin} must be an object.`);
  }
  const id = parseNonEmptyString(value.id, `${origin}.id`);
  const name = parseNonEmptyString(value.name, `${origin}.name`);
  const url = parseNonEmptyString(value.url, `${origin}.url`);
  parseSafeUrl(url);
  const allowedDomains = parseStringList(value.allowedDomains, `${origin}.allowedDomains`);
  const allowedPaths = parseStringList(value.allowedPaths, `${origin}.allowedPaths`);
  const enabled = value.enabled !== false;
  const method = value.method === undefined ? "GET" : value.method;
  if (method !== "GET") {
    throw new Error(`OSINT source ${origin}.method must be GET.`);
  }
  const contentType = value.contentType === undefined ? "json" : value.contentType;
  if (contentType !== "json") {
    throw new Error(`OSINT source ${origin}.contentType must be json.`);
  }
  const tags = value.tags === undefined ? [] : parseStringList(value.tags, `${origin}.tags`);
  return { id, name, url, enabled, allowedDomains, allowedPaths, method, contentType, tags };
}

function isUrlAllowedBySource(url: URL, source: OsintAllowedSource): boolean {
  return (
    source.allowedDomains.some((domain) => domainMatches(url.hostname, domain)) &&
    source.allowedPaths.some((path) => url.pathname.startsWith(path))
  );
}

function domainMatches(hostname: string, allowedDomain: string): boolean {
  const host = hostname.toLowerCase();
  const domain = allowedDomain.toLowerCase();
  if (domain.startsWith(".")) return host.endsWith(domain);
  return host === domain;
}

function parseSafeUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`OSINT source must use https: ${redactUrlForMessage(url)}`);
  }
  if (url.username || url.password) {
    throw new Error("OSINT source URL must not include credentials.");
  }
  return url;
}

function redactUrlForMessage(url: URL): string {
  return `${url.protocol}//${url.hostname}${url.pathname}`;
}

function parseStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty string array.`);
  }
  return normalizeStringArray(value, label);
}

function normalizeStringArray(value: unknown, label = "value"): string[] {
  if (!Array.isArray(value)) return [];
  const strings = value.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label} must contain only non-empty strings.`);
    }
    return item.trim();
  });
  return [...new Set(strings)];
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
