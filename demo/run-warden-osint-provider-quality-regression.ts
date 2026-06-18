import type { OsintFetchLike } from "../src/connectors/osint/http-client.ts";
import { runNaturalLanguageOsintSearch } from "../src/connectors/osint/search.ts";
import type { OsintSearchSourceRegistry } from "../src/connectors/osint/search-types.ts";

const registry: OsintSearchSourceRegistry = {
  version: "v1",
  sources: [
    {
      id: "gdelt-shared-a",
      name: "Shared GDELT rate-limit provider A",
      kind: "gdelt-doc",
      endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
      enabled: true,
      allowedDomains: ["api.gdeltproject.org"],
      allowedPaths: ["/api/v2/doc/"],
      queryPrefix: "domain:first-shared.example",
      reliability: "B2",
      rateLimitKey: "shared-gdelt-test",
      cooldownMs: 60_000,
      tags: ["quality-test"]
    },
    {
      id: "gdelt-shared-b",
      name: "Shared GDELT rate-limit provider B",
      kind: "gdelt-doc",
      endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
      enabled: true,
      allowedDomains: ["api.gdeltproject.org"],
      allowedPaths: ["/api/v2/doc/"],
      queryPrefix: "domain:second-shared.example",
      reliability: "B2",
      rateLimitKey: "shared-gdelt-test",
      cooldownMs: 60_000,
      tags: ["quality-test"]
    },
    {
      id: "rate-limit-provider",
      name: "Rate limited provider",
      kind: "rss",
      endpoint: "https://osint-quality.example.test/rss/rate-limit.xml",
      enabled: true,
      allowedDomains: ["osint-quality.example.test"],
      allowedPaths: ["/rss/"],
      reliability: "B2",
      cooldownMs: 60_000,
      tags: ["quality-test"]
    },
    {
      id: "rate-limit-provider",
      name: "Rate limited provider duplicate",
      kind: "rss",
      endpoint: "https://osint-quality.example.test/rss/rate-limit-repeat.xml",
      enabled: true,
      allowedDomains: ["osint-quality.example.test"],
      allowedPaths: ["/rss/"],
      reliability: "B2",
      cooldownMs: 60_000,
      tags: ["quality-test"]
    },
    {
      id: "timeout-provider",
      name: "Timeout provider",
      kind: "rss",
      endpoint: "https://osint-quality.example.test/rss/timeout.xml",
      enabled: true,
      allowedDomains: ["osint-quality.example.test"],
      allowedPaths: ["/rss/"],
      reliability: "C2",
      tags: ["quality-test"]
    },
    {
      id: "http-error-provider",
      name: "HTTP error provider",
      kind: "rss",
      endpoint: "https://osint-quality.example.test/rss/http-error.xml",
      enabled: true,
      allowedDomains: ["osint-quality.example.test"],
      allowedPaths: ["/rss/"],
      reliability: "C2",
      tags: ["quality-test"]
    },
    {
      id: "profile-reliability-provider",
      name: "Profile reliability provider",
      kind: "rss",
      endpoint: "https://osint-quality.example.test/rss/profile.xml",
      enabled: true,
      allowedDomains: ["osint-quality.example.test"],
      allowedPaths: ["/rss/"],
      reliability: "B2",
      tags: ["quality-test"]
    },
    {
      id: "fallback-reliability-provider",
      name: "Fallback reliability provider",
      kind: "rss",
      endpoint: "https://osint-quality.example.test/rss/fallback.xml",
      enabled: true,
      allowedDomains: ["osint-quality.example.test"],
      allowedPaths: ["/rss/"],
      tags: ["quality-test"]
    }
  ]
};

const fetchCallsByPath = new Map<string, number>();

const fetchImpl: OsintFetchLike = async (url) => {
  const pathname = new URL(url).pathname;
  fetchCallsByPath.set(pathname, (fetchCallsByPath.get(pathname) ?? 0) + 1);

  if (url.includes("first-shared.example")) {
    return {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "shared rate limited"
    };
  }
  if (url.includes("second-shared.example")) {
    throw new Error(`Shared cooldown failed; second GDELT source should not be fetched: ${url}`);
  }
  if (pathname.endsWith("/rate-limit.xml")) {
    return {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limited"
    };
  }
  if (pathname.endsWith("/timeout.xml")) {
    return new Promise(() => undefined);
  }
  if (pathname.endsWith("/http-error.xml")) {
    return {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "unavailable"
    };
  }
  if (pathname.endsWith("/profile.xml")) {
    return {
      ok: true,
      status: 200,
      text: async () =>
        makeRss(
          "Profile reliability supply chain update",
          "https://news.example.test/profile",
          "Supply chain reporting from a provider with a source reliability profile."
        )
    };
  }
  if (pathname.endsWith("/fallback.xml")) {
    return {
      ok: true,
      status: 200,
      text: async () =>
        makeRss(
          "Fallback supply chain update",
          "https://news.example.test/fallback",
          "Supply chain reporting from a provider without a source reliability profile."
        )
    };
  }

  throw new Error(`Unexpected fetch URL: ${url}`);
};

const result = await runNaturalLanguageOsintSearch(
  {
    query: "supply chain",
    runId: "run_osint_provider_quality_regression",
    approvalId: "approval_osint_provider_quality_regression",
    maxResults: 6,
    timeoutMs: 5,
    userAgent: "warden-provider-quality-regression/1.0"
  },
  registry,
  { fetchImpl, now: "2026-06-15T00:00:00.000Z" }
);

assertEqual(result.status, "succeeded", "search status");
assertEqual(result.units.length, 2, "successful unit count");
assertEqual(fetchCallsByPath.get("/rss/rate-limit.xml"), 1, "first rate-limit fetch call");
assertEqual(fetchCallsByPath.get("/rss/rate-limit-repeat.xml") ?? 0, 0, "cooldown skipped duplicate provider");
assertEqual(fetchCallsByPath.get("/api/v2/doc/doc"), 1, "shared GDELT rate-limit fetch call");

assertProviderWarning(result.providerWarnings, "rate_limited", "rate limit warning");
assertProviderWarning(result.providerWarnings, "timeout", "timeout warning");
assertProviderWarning(result.providerWarnings, "http_error", "HTTP error warning");
assertProviderWarning(result.providerWarnings, "cooldown", "cooldown warning");

const failedTelemetry = result.providerTelemetry?.filter((entry) => entry.failed) ?? [];
assertEqual(failedTelemetry.length, 4, "failed telemetry count");
assertTelemetry(failedTelemetry, "gdelt-shared-a", "rate_limited", 429);
assertTelemetry(failedTelemetry, "rate-limit-provider", "rate_limited", 429);
assertTelemetry(failedTelemetry, "timeout-provider", "timeout");
assertTelemetry(failedTelemetry, "http-error-provider", "http_error", 503);

const cooldownTelemetry = result.providerTelemetry?.find(
  (entry) => entry.sourceId === "rate-limit-provider" && entry.attempted === false
);
assertTruthy(cooldownTelemetry, "cooldown telemetry");
const sharedCooldownTelemetry = result.providerTelemetry?.find(
  (entry) => entry.sourceId === "gdelt-shared-b" && entry.attempted === false
);
assertTruthy(sharedCooldownTelemetry, "shared cooldown telemetry");

const profileUnit = result.units.find((unit) => unit.sourceUri === "https://news.example.test/profile");
assertEqual(profileUnit?.reliability, "B2", "source reliability profile default");
const fallbackUnit = result.units.find((unit) => unit.sourceUri === "https://news.example.test/fallback");
assertEqual(fallbackUnit?.reliability, "C3", "fallback reliability default");

console.log("WARDEN OSINT provider quality regression: passed");

function makeRss(title: string, link: string, description: string): string {
  return [
    "<rss><channel><item>",
    `<title>${title}</title>`,
    `<link>${link}</link>`,
    `<description>${description}</description>`,
    "<pubDate>Mon, 15 Jun 2026 00:00:00 GMT</pubDate>",
    "</item></channel></rss>"
  ].join("");
}

function assertProviderWarning(
  warnings: Array<{ kind: string; message: string }> | undefined,
  expectedKind: string,
  label: string
): void {
  const warning = warnings?.find((entry) => entry.kind === expectedKind);
  if (!warning) {
    throw new Error(`${label} missing provider warning kind=${expectedKind}: ${JSON.stringify(warnings)}`);
  }
  assertIncludes(warning.message, expectedKind === "cooldown" ? "cooldown" : expectedKind, label);
}

function assertTelemetry(
  entries: Array<{ sourceId: string; errorKind?: string; status?: number; latencyMs: number; cooldownUntil?: string }>,
  sourceId: string,
  errorKind: string,
  status?: number
): void {
  const entry = entries.find((item) => item.sourceId === sourceId);
  assertTruthy(entry, `${sourceId} telemetry`);
  assertEqual(entry?.errorKind, errorKind, `${sourceId} error kind`);
  if (status !== undefined) assertEqual(entry?.status, status, `${sourceId} HTTP status`);
  assertTruthy(typeof entry?.latencyMs === "number" && entry.latencyMs >= 0, `${sourceId} latency`);
  assertTruthy(Boolean(entry?.cooldownUntil), `${sourceId} cooldown`);
}

function assertTruthy(value: unknown, label: string): void {
  if (!value) {
    throw new Error(`${label} failed`);
  }
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
