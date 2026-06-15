import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWardenConfig } from "../src/agent/config.ts";
import type { OsintFetchLike } from "../src/connectors/osint/http-client.ts";
import { dispatchOsintToolCall } from "../src/mcp/osint/tools.ts";

const dir = mkdtempSync(join(tmpdir(), "warden-osint-search-mcp-"));
const sourcesPath = join(dir, "search-sources.json");
writeFileSync(
  sourcesPath,
  JSON.stringify(
    {
      version: "v1",
      sources: [
        {
          id: "gdelt-test",
          name: "GDELT test",
          kind: "gdelt-doc",
          endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
          enabled: true,
          allowedDomains: ["api.gdeltproject.org"],
          allowedPaths: ["/api/v2/doc/"],
          tags: ["gdelt", "test"]
        }
      ]
    },
    null,
    2
  )
);

let fetchedUrl = "";
const fetchImpl: OsintFetchLike = async (url) => {
  fetchedUrl = url;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      articles: [
        {
          title: "South Korea supply chain disruption prompts semiconductor equipment watch",
          url: "https://example.com/news/supply-chain-watch",
          seendate: "20260615000000",
          domain: "example.com",
          sourceCountry: "South Korea",
          language: "English"
        }
      ]
    })
  };
};

try {
  await assertRejects(
    () =>
      dispatchOsintToolCall(
        "search_news",
        {
          query: "대한민국 공급망 리스크",
          runId: "run_osint_mcp_regression",
          approvalId: "approval_osint_mcp_regression"
        },
        {
          config: loadWardenConfig({
            WARDEN_MODEL_PROVIDER: "mock",
            WARDEN_OSINT_LIVE_OPT_IN: "false",
            WARDEN_OSINT_SEARCH_SOURCES: sourcesPath
          })
        }
      ),
    "live opt-in guard"
  );

  const output = await dispatchOsintToolCall(
    "search_news",
    {
      query: "대한민국 공급망 리스크",
      runId: "run_osint_mcp_regression",
      approvalId: "approval_osint_mcp_regression",
      preferredDomains: ["investing.com"],
      maxResults: 2
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

  assertEqual(output.result.status, "succeeded", "search status");
  assertEqual(output.result.units.length, 1, "search unit count");
  assertIncludes(output.result.units[0].tags.join(","), "natural-language-search", "natural language tag");
  assertIncludes(output.result.units[0].tags.join(","), "sourcevet-required", "sourcevet tag");
  assertIncludes(fetchedUrl, "query=", "gdelt query parameter");
  assertIncludes(decodeURIComponent(fetchedUrl), "domain:investing.com", "preferred domain query");

  console.log("WARDEN OSINT search MCP regression: passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

async function assertRejects(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${label}: expected rejection`);
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
