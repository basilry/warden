import { loadWardenConfig } from "../src/agent/config.ts";
import type { OsintFetchLike } from "../src/connectors/osint/http-client.ts";
import { dispatchOsintToolCall } from "../src/mcp/osint/tools.ts";

const fetchedUrls: string[] = [];
const fetchImpl: OsintFetchLike = async (url) => {
  fetchedUrls.push(url);
  return {
    ok: true,
    status: 200,
    text: async () => `
      <!doctype html>
      <html>
        <head>
          <title>Supply Chain Watch &amp; Semiconductor Brief</title>
          <link rel="canonical" href="/briefs/supply-chain-watch" />
        </head>
        <body>
          <article>
            <h1>Supply Chain Watch</h1>
            <p>South Korea semiconductor equipment teams reported a logistics watchpoint after a port delay.</p>
            <p>Analysts flagged photoresist inventory, rare gas routing, and alternate supplier readiness for follow-up review.</p>
            <a href="/briefs/related">Related semiconductor briefing</a>
            <a href="mailto:analyst@example.test">Email analyst</a>
          </article>
        </body>
      </html>
    `
  };
};

await assertRejectsIncludes(
  () =>
    dispatchOsintToolCall(
      "scrape_news",
      {
        url: "https://news.example.test/briefs/supply-chain-watch?utm=1",
        runId: "run_osint_scrape_mcp_regression",
        approvalId: "approval_osint_scrape_mcp_regression"
      },
      {
        config: loadWardenConfig({
          WARDEN_MODEL_PROVIDER: "mock",
          WARDEN_OSINT_LIVE_OPT_IN: "false"
        })
      }
    ),
  "WARDEN_OSINT_LIVE_OPT_IN=true",
  "live opt-in guard"
);

await assertRejectsIncludes(
  () =>
    dispatchOsintToolCall(
      "scrape_news",
      {
        url: "file:///tmp/not-allowed.html",
        runId: "run_osint_scrape_mcp_regression",
        approvalId: "approval_osint_scrape_mcp_regression"
      },
      {
        config: loadWardenConfig({
          WARDEN_MODEL_PROVIDER: "mock",
          WARDEN_OSINT_LIVE_OPT_IN: "true"
        }),
        fetchImpl
      }
    ),
  "http or https",
  "http scheme guard"
);
assertEqual(fetchedUrls.length, 0, "guarded fetch count");

await assertRejectsIncludes(
  () =>
    dispatchOsintToolCall(
      "scrape_news",
      {
        url: "http://127.0.0.1:8080/internal",
        runId: "run_osint_scrape_mcp_regression",
        approvalId: "approval_osint_scrape_mcp_regression"
      },
      {
        config: loadWardenConfig({
          WARDEN_MODEL_PROVIDER: "mock",
          WARDEN_OSINT_LIVE_OPT_IN: "true"
        }),
        fetchImpl
      }
    ),
  "private network",
  "private network guard"
);
assertEqual(fetchedUrls.length, 0, "private URL guarded fetch count");

const output = await dispatchOsintToolCall(
  "scrape_news",
  {
    urls: [
      "https://news.example.test/briefs/supply-chain-watch?utm=1#ignored",
      "https://news.example.test/briefs/second"
    ],
    runId: "run_osint_scrape_mcp_regression",
    approvalId: "approval_osint_scrape_mcp_regression",
    maxDocuments: 1,
    maxChars: 120
  },
  {
    config: loadWardenConfig({
      WARDEN_MODEL_PROVIDER: "mock",
      WARDEN_OSINT_LIVE_OPT_IN: "true",
      WARDEN_OSINT_MAX_RESULTS: "5",
      WARDEN_OSINT_TIMEOUT_MS: "50"
    }),
    fetchImpl,
    now: "2026-06-15T00:00:00.000Z"
  }
);

assertEqual(output.result.status, "succeeded", "scrape status");
assertEqual(fetchedUrls.length, 1, "maxDocuments fetch count");
assertEqual(output.result.documents.length, 1, "scrape document count");
assertEqual(output.result.units.length, 1, "scrape unit count");
assertEqual(output.result.documents[0].canonicalUrl, "https://news.example.test/briefs/supply-chain-watch", "canonical url");
assertEqual(output.result.documents[0].title, "Supply Chain Watch & Semiconductor Brief", "title extraction");
assertAtMost(output.result.documents[0].textExcerpt.length, 120, "maxChars excerpt");
assertIncludes(output.result.documents[0].textExcerpt, "South Korea semiconductor", "text extraction");
assertEqual(output.result.documents[0].links.length, 1, "http link filtering");
assertEqual(output.result.documents[0].links[0].url, "https://news.example.test/briefs/related", "link normalization");
assertEqual(output.result.units[0].sourceType, "html", "KnowledgeUnit source type");
assertIncludes(output.result.units[0].tags.join(","), "html-scrape", "html scrape tag");
assertIncludes(output.result.units[0].tags.join(","), "sourcevet-required", "sourcevet tag");
assertIncludes(output.result.units[0].claims[0].text, "Supply Chain Watch", "KnowledgeUnit claim text");
assertAtLeast(output.result.artifacts.length, 2, "scrape artifacts");

console.log("WARDEN OSINT scrape MCP regression: passed");

async function assertRejectsIncludes(
  fn: () => Promise<unknown>,
  expected: string,
  label: string
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assertIncludes((error as Error).message, expected, label);
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

function assertAtMost(actual: number, expected: number, label: string): void {
  if (actual > expected) {
    throw new Error(`${label} failed: expected <= ${expected} actual=${actual}`);
  }
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) {
    throw new Error(`${label} failed: expected >= ${expected} actual=${actual}`);
  }
}
