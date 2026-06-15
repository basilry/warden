import { readFileSync } from "node:fs";
import type { OsintSearchSource, OsintSearchSourceRegistry } from "./search-types.ts";

export function loadOsintSearchSources(path: string): OsintSearchSourceRegistry {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parseOsintSearchSources(parsed, path);
}

export function parseOsintSearchSources(value: unknown, origin = "inline"): OsintSearchSourceRegistry {
  if (!isRecord(value)) {
    throw new Error(`OSINT search sources ${origin} must be an object.`);
  }
  const version = typeof value.version === "string" && value.version.trim() ? value.version.trim() : "v1";
  if (!Array.isArray(value.sources)) {
    throw new Error(`OSINT search sources ${origin} must include sources[].`);
  }
  return {
    version,
    sources: value.sources.map((source, index) => parseSearchSource(source, `${origin}:sources[${index}]`))
  };
}

export function selectSearchSources(
  registry: OsintSearchSourceRegistry,
  options: { sourceIds?: string[] } = {}
): OsintSearchSource[] {
  const sourceIds = normalizeStringArray(options.sourceIds);
  return registry.sources
    .filter((source) => source.enabled)
    .filter((source) => sourceIds.length === 0 || sourceIds.includes(source.id));
}

export function assertSearchEndpointAllowed(source: OsintSearchSource): URL {
  const url = new URL(source.endpoint);
  if (url.protocol !== "https:") {
    throw new Error(`OSINT search endpoint must use https: ${source.id}`);
  }
  if (url.username || url.password) {
    throw new Error(`OSINT search endpoint must not include credentials: ${source.id}`);
  }
  const domainAllowed = source.allowedDomains.some((domain) => domainMatches(url.hostname, domain));
  const pathAllowed = source.allowedPaths.some((path) => url.pathname.startsWith(path));
  if (!domainAllowed || !pathAllowed) {
    throw new Error(`OSINT search endpoint is not allowlisted by its source policy: ${source.id}`);
  }
  return url;
}

function parseSearchSource(value: unknown, origin: string): OsintSearchSource {
  if (!isRecord(value)) {
    throw new Error(`OSINT search source ${origin} must be an object.`);
  }
  const kind = parseKind(value.kind, `${origin}.kind`);
  const source: OsintSearchSource = {
    id: parseNonEmptyString(value.id, `${origin}.id`),
    name: parseNonEmptyString(value.name, `${origin}.name`),
    kind,
    endpoint: parseNonEmptyString(value.endpoint, `${origin}.endpoint`),
    enabled: value.enabled !== false,
    allowedDomains: parseStringList(value.allowedDomains, `${origin}.allowedDomains`),
    allowedPaths: parseStringList(value.allowedPaths, `${origin}.allowedPaths`),
    tags: value.tags === undefined ? [] : parseStringList(value.tags, `${origin}.tags`),
    apiKeyEnv: value.apiKeyEnv === undefined ? undefined : parseNonEmptyString(value.apiKeyEnv, `${origin}.apiKeyEnv`),
    queryPrefix: value.queryPrefix === undefined ? undefined : parseNonEmptyString(value.queryPrefix, `${origin}.queryPrefix`),
    querySuffix: value.querySuffix === undefined ? undefined : parseNonEmptyString(value.querySuffix, `${origin}.querySuffix`),
    defaultFreshness:
      value.defaultFreshness === undefined ? undefined : parseFreshness(value.defaultFreshness, `${origin}.defaultFreshness`)
  };
  assertSearchEndpointAllowed(source);
  return source;
}

function parseKind(value: unknown, label: string): OsintSearchSource["kind"] {
  if (value === "gdelt-doc" || value === "brave-web" || value === "rss") return value;
  throw new Error(`${label} must be gdelt-doc, brave-web, or rss.`);
}

function parseFreshness(value: unknown, label: string): OsintSearchSource["defaultFreshness"] {
  if (value === "pd" || value === "pw" || value === "pm" || value === "py") return value;
  throw new Error(`${label} must be pd, pw, pm, or py.`);
}

function domainMatches(hostname: string, allowedDomain: string): boolean {
  const host = hostname.toLowerCase();
  const domain = allowedDomain.toLowerCase();
  if (domain.startsWith(".")) return host.endsWith(domain);
  return host === domain;
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
