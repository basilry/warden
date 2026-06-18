import { readFileSync } from "node:fs";

export const DEFAULT_OSINT_SOURCE_REGISTRY_PATH = "fixtures/osint/source-registry.json";

export type OsintSourceKind = "official" | "news" | "market" | "think_tank";

export type OsintRegisteredSource = {
  id: string;
  name: string;
  kind: OsintSourceKind;
  homepageUrl: string;
  enabled: boolean;
  allowedDomains: string[];
  allowedPaths: string[];
  robotsUrl?: string;
  sitemapUrls?: string[];
  reliability?: string;
  tags?: string[];
};

export type OsintSourceRegistry = {
  version: string;
  sources: OsintRegisteredSource[];
};

export type SourceRegistryAllowedCheck = {
  source: OsintRegisteredSource;
  url: URL;
};

export type SourceRegistrySelectionOptions = {
  kinds?: OsintSourceKind[];
  sourceIds?: string[];
};

export function loadOsintSourceRegistry(path = DEFAULT_OSINT_SOURCE_REGISTRY_PATH): OsintSourceRegistry {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parseOsintSourceRegistry(parsed, path);
}

export function parseOsintSourceRegistry(value: unknown, origin = "inline"): OsintSourceRegistry {
  if (!isRecord(value)) {
    throw new Error(`OSINT source registry ${origin} must be an object.`);
  }
  const version = typeof value.version === "string" && value.version.trim() ? value.version.trim() : "v1";
  if (!Array.isArray(value.sources)) {
    throw new Error(`OSINT source registry ${origin} must include a sources array.`);
  }

  const sources = value.sources.map((source, index) => parseRegisteredSource(source, `${origin}:sources[${index}]`));
  assertUniqueIds(sources, origin);
  return { version, sources };
}

export function selectRegisteredSources(
  registry: OsintSourceRegistry,
  options: SourceRegistrySelectionOptions = {}
): OsintRegisteredSource[] {
  const sourceIds = normalizeStringArray(options.sourceIds);
  const kinds = normalizeKinds(options.kinds);
  return registry.sources
    .filter((source) => source.enabled)
    .filter((source) => sourceIds.length === 0 || sourceIds.includes(source.id))
    .filter((source) => kinds.length === 0 || kinds.includes(source.kind));
}

export function assertSourceRegistryUrlAllowed(
  sourceUrl: string,
  registry: OsintSourceRegistry,
  options: SourceRegistrySelectionOptions = {}
): SourceRegistryAllowedCheck {
  const url = parseSafeUrl(sourceUrl);
  const matchingSource = selectRegisteredSources(registry, options).find((source) => isUrlAllowedBySource(url, source));
  if (!matchingSource) {
    throw new Error(`OSINT source registry blocked non-allowed URL: ${redactUrlForMessage(url)}`);
  }
  return { source: matchingSource, url };
}

export function isSourceRegistryUrlAllowed(
  sourceUrl: string,
  registry: OsintSourceRegistry,
  options: SourceRegistrySelectionOptions = {}
): boolean {
  try {
    assertSourceRegistryUrlAllowed(sourceUrl, registry, options);
    return true;
  } catch {
    return false;
  }
}

export function canonicalizeSourceRegistryUrl(sourceUrl: string): string {
  return parseSafeUrl(sourceUrl).toString();
}

function parseRegisteredSource(value: unknown, origin: string): OsintRegisteredSource {
  if (!isRecord(value)) {
    throw new Error(`OSINT registered source ${origin} must be an object.`);
  }

  const source: OsintRegisteredSource = {
    id: parseNonEmptyString(value.id, `${origin}.id`),
    name: parseNonEmptyString(value.name, `${origin}.name`),
    kind: parseKind(value.kind, `${origin}.kind`),
    homepageUrl: canonicalizeSourceRegistryUrl(parseNonEmptyString(value.homepageUrl, `${origin}.homepageUrl`)),
    enabled: value.enabled !== false,
    allowedDomains: parseAllowedDomains(value.allowedDomains, `${origin}.allowedDomains`),
    allowedPaths: parseAllowedPaths(value.allowedPaths, `${origin}.allowedPaths`),
    robotsUrl:
      value.robotsUrl === undefined
        ? undefined
        : canonicalizeSourceRegistryUrl(parseNonEmptyString(value.robotsUrl, `${origin}.robotsUrl`)),
    sitemapUrls:
      value.sitemapUrls === undefined
        ? undefined
        : parseStringList(value.sitemapUrls, `${origin}.sitemapUrls`).map((url) => canonicalizeSourceRegistryUrl(url)),
    reliability: value.reliability === undefined ? undefined : parseReliability(value.reliability, `${origin}.reliability`),
    tags: value.tags === undefined ? [] : parseStringList(value.tags, `${origin}.tags`)
  };

  assertUrlMatchesOwnPolicy(source.homepageUrl, source, `${origin}.homepageUrl`);
  if (source.robotsUrl) assertUrlMatchesOwnPolicy(source.robotsUrl, source, `${origin}.robotsUrl`);
  for (const [index, sitemapUrl] of (source.sitemapUrls ?? []).entries()) {
    assertUrlMatchesOwnPolicy(sitemapUrl, source, `${origin}.sitemapUrls[${index}]`);
  }

  return source;
}

function assertUniqueIds(sources: OsintRegisteredSource[], origin: string): void {
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.id)) {
      throw new Error(`OSINT source registry ${origin} includes duplicate source id: ${source.id}`);
    }
    seen.add(source.id);
  }
}

function assertUrlMatchesOwnPolicy(sourceUrl: string, source: OsintRegisteredSource, label: string): void {
  const url = parseSafeUrl(sourceUrl);
  if (!isUrlAllowedBySource(url, source)) {
    throw new Error(`${label} is not allowed by its source allowedDomains/allowedPaths policy.`);
  }
}

function isUrlAllowedBySource(url: URL, source: Pick<OsintRegisteredSource, "allowedDomains" | "allowedPaths">): boolean {
  return (
    source.allowedDomains.some((domain) => domainMatches(url.hostname, domain)) &&
    source.allowedPaths.some((path) => pathMatches(url.pathname, path))
  );
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

function parseSafeUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`OSINT registered source must use https: ${redactUrlForMessage(url)}`);
  }
  if (url.username || url.password) {
    throw new Error("OSINT registered source URL must not include credentials.");
  }
  url.hash = "";
  return url;
}

function parseKind(value: unknown, label: string): OsintSourceKind {
  if (value === "official" || value === "news" || value === "market" || value === "think_tank") return value;
  throw new Error(`${label} must be official, news, market, or think_tank.`);
}

function parseReliability(value: unknown, label: string): string {
  if (typeof value === "string" && /^[A-F][1-6]$/.test(value)) return value;
  throw new Error(`${label} must use Admiralty reliability format A1-F6.`);
}

function parseAllowedDomains(value: unknown, label: string): string[] {
  return parseStringList(value, label).map((domain) => {
    const normalized = domain.toLowerCase().replace(/\.$/, "");
    if (!/^\.?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(normalized)) {
      throw new Error(`${label} must contain bare domains without schemes, paths, or wildcards.`);
    }
    return normalized;
  });
}

function parseAllowedPaths(value: unknown, label: string): string[] {
  return parseStringList(value, label).map((path) => {
    if (!path.startsWith("/") || path.includes("#") || /\s/.test(path)) {
      throw new Error(`${label} entries must be URL paths beginning with / and without spaces or fragments.`);
    }
    return path;
  });
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

function normalizeKinds(value: unknown): OsintSourceKind[] {
  if (!Array.isArray(value)) return [];
  return value.map((kind, index) => parseKind(kind, `kinds[${index}]`));
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function redactUrlForMessage(url: URL): string {
  return `${url.protocol}//${url.hostname}${url.pathname}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
