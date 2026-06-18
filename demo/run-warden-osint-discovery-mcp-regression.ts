import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWardenConfig } from "../src/agent/config.ts";
import type { OsintFetchLike } from "../src/connectors/osint/http-client.ts";
import { dispatchOsintToolCall } from "../src/mcp/osint/tools.ts";

const dir = mkdtempSync(join(tmpdir(), "warden-osint-discovery-mcp-"));
const sourcesPath = join(dir, "search-sources.json");
writeFileSync(
  sourcesPath,
  JSON.stringify(
    {
      version: "v1",
      sources: [
        {
          id: "gdelt-discovery-test",
          name: "GDELT discovery test",
          kind: "gdelt-doc",
          endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
          enabled: true,
          allowedDomains: ["api.gdeltproject.org"],
          allowedPaths: ["/api/v2/doc/"],
          reliability: "C3",
          tags: ["gdelt", "discovery-test"]
        }
      ]
    },
    null,
    2
  )
);

const fetchedUrls: string[] = [];
const fetchImpl: OsintFetchLike = async (url) => {
  fetchedUrls.push(url);
  const parsed = new URL(url);
  if (parsed.hostname === "api.gdeltproject.org") {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        articles: [
          {
            title: "Taiwan Strait tensions prompt amphibious readiness watch",
            url: "https://news.example.test/asia/taiwan-strait-readiness",
            seendate: "20260615000000",
            domain: "news.example.test",
            sourceCountry: "Taiwan",
            language: "English"
          }
        ]
      })
    };
  }
  if (parsed.hostname === "news.example.test") {
    return {
      ok: true,
      status: 200,
      text: async () => `
        <!doctype html>
        <html>
          <head>
            <title>Taiwan Strait readiness watch</title>
            <link rel="canonical" href="https://news.example.test/asia/taiwan-strait-readiness" />
          </head>
          <body>
            <article>
              <h1>Taiwan Strait readiness watch</h1>
              <p>Regional analysts assessed amphibious lift, missile exercises, air defense alerts, and shipping disruption indicators.</p>
              <p>The report says near-term invasion risk remains uncertain and depends on mobilization, logistics, and political signaling.</p>
            </article>
          </body>
        </html>
      `
    };
  }
  throw new Error(`Unexpected fetch URL: ${url}`);
};

try {
  const output = await dispatchOsintToolCall(
    "discover_news",
    {
      query: "중국의 대만 침공 가능성",
      runId: "run_osint_discovery_mcp_regression",
      approvalId: "approval_osint_discovery_mcp_regression",
      maxResults: 2,
      maxScrapeChars: 800
    },
    {
      config: loadWardenConfig({
        WARDEN_MODEL_PROVIDER: "mock",
        WARDEN_OSINT_LIVE_OPT_IN: "true",
        WARDEN_OSINT_SEARCH_SOURCES: sourcesPath,
        WARDEN_OSINT_MAX_RESULTS: "2",
        WARDEN_OSINT_TIMEOUT_MS: "50"
      }),
      fetchImpl,
      now: "2026-06-15T00:00:00.000Z"
    }
  );

  assertEqual(output.result.status, "succeeded", "discovery status");
  assertEqual(output.result.discoveredUrls.length, 1, "discovered URL count");
  assertEqual(output.result.scrapedUrls.length, 1, "scraped URL count");
  assertAtLeast(output.result.artifacts.length, 4, "combined artifacts");
  assertIncludes(output.result.units[0].tags.join(","), "html-scrape", "scraped unit tag");
  assertIncludes(output.result.units[0].claims[0].text, "amphibious lift", "scraped article text");
  assertTruthy(fetchedUrls.find((url) => url.includes("api.gdeltproject.org")), "discovery fetch");
  assertTruthy(fetchedUrls.find((url) => url.includes("news.example.test/asia/taiwan-strait-readiness")), "scrape fetch");
  assertFalsy(fetchedUrls.find((url) => url.includes("api.search.brave.com")), "Brave fetch should not be required");

  console.log("WARDEN OSINT discovery MCP regression: passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function assertTruthy(value: unknown, label: string): void {
  if (!value) {
    throw new Error(`${label} failed`);
  }
}

function assertFalsy(value: unknown, label: string): void {
  if (value) {
    throw new Error(`${label} failed: expected falsy value, got ${String(value)}`);
  }
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) {
    throw new Error(`${label} failed: expected >= ${expected} actual=${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
