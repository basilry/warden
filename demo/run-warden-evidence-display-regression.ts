import type { Evidence, KnowledgeUnit } from "../src/agent/types.ts";
import {
  buildEvidenceDisplayCard,
  formatEvidenceDisplay,
  formatEvidenceDisplayString
} from "../src/runtime/evidence-display.ts";

const articleBody = [
  "Subscribe to our newsletter for alerts.",
  "Advertisement.",
  "South Korea semiconductor equipment teams reported a logistics watchpoint after a port delay.",
  "Analysts flagged photoresist inventory, rare gas routing, and alternate supplier readiness for follow-up review.",
  "Regional shipping desks said insurance friction and customs checks were the main observable constraints.",
  "The source also noted that buffer inventory should be compared against plausible disruption windows.",
  "Cookie Policy Privacy Policy Terms of Service All rights reserved."
].join(" ");
const longArticleBody = Array.from({ length: 3 }, () => articleBody).join(" ");

const unit: KnowledgeUnit = {
  id: "ku_article_body",
  sourceUri: "https://news.example.test/briefs/supply-chain-watch?utm_source=newsletter#article",
  sourceType: "html",
  extractedAt: "2026-06-18T00:00:00.000Z",
  claims: [
    {
      id: "claim_article_body",
      text: longArticleBody,
      confidence: 0.58,
      evidenceRefs: ["https://news.example.test/briefs/supply-chain-watch#text-excerpt"]
    }
  ],
  provenance: {
    capturedBy: "connector",
    originalLocation: "https://news.example.test/briefs/supply-chain-watch#document-1",
    contentHash: "hash_article_body",
    parserVersion: "regression"
  },
  reliability: "C3",
  tags: ["live-osint", "html-scrape"]
};

const card = buildEvidenceDisplayCard(unit, {
  title: "Supply Chain Watch",
  publishedDate: "2026-06-17T12:00:00.000Z",
  sourceKind: "external OSINT"
});
const display = formatEvidenceDisplayString(unit, {
  title: "Supply Chain Watch",
  publishedDate: "2026-06-17T12:00:00.000Z",
  sourceKind: "external OSINT"
});

assertEqual(card.canonicalUrl, "https://news.example.test/briefs/supply-chain-watch", "canonical URL");
assertEqual(card.domain, "news.example.test", "domain");
assertEqual(card.publishedDate, "2026-06-17", "published date");
assertEqual(unit.claims[0].text, longArticleBody, "internal KnowledgeUnit text preserved");
assertAtMost(card.summary.length, 280 + 3, "summary length");
assertIncludes(display, "제목: Supply Chain Watch", "title display");
assertIncludes(display, "URL: https://news.example.test/briefs/supply-chain-watch", "URL display");
assertIncludes(display, "발행/출처: news.example.test", "source display");
assertIncludes(display, "게시일: 2026-06-17", "date display");
assertIncludes(display, "신뢰도: C3", "reliability display");
assertIncludes(display, "[external OSINT/html]", "source kind display");
assertNotIncludes(display, "요약:", "article summary hidden by default when URL exists");
assertNotIncludes(display, "Subscribe", "newsletter boilerplate");
assertNotIncludes(display, "Advertisement", "ad boilerplate");
assertNotIncludes(display, "Cookie Policy", "cookie boilerplate");
assertNotIncludes(display, "Terms of Service", "terms boilerplate");
assertNotIncludes(display, longArticleBody, "full article body");

const achEvidence: Evidence = {
  id: "ev_ach",
  text: "Observed logistics delays support a supply-chain watchpoint.",
  source: "analyst-fixture",
  reliability: "B2",
  weight: 0.7
};
const evidenceList = formatEvidenceDisplay({
  achEvidence: [achEvidence],
  domainEvidence: [],
  fetchedEvidence: [unit],
  ragEvidence: []
});
assertEqual(evidenceList.length, 2, "combined evidence display count");
assertIncludes(evidenceList[0], "[실시간 OSINT/html]", "fetched evidence source kind");
assertIncludes(evidenceList[0], "URL: https://news.example.test/briefs/supply-chain-watch", "fetched evidence URL");
assertIncludes(evidenceList[1], "[ACH]", "ACH evidence source kind");

console.log("WARDEN evidence display regression: passed");

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertNotIncludes(value: string, unexpected: string, label: string): void {
  if (value.includes(unexpected)) {
    throw new Error(`${label} included unexpected output: ${unexpected}\n${value}`);
  }
}

function assertAtMost(actual: number, expected: number, label: string): void {
  if (actual > expected) {
    throw new Error(`${label} failed: expected <= ${expected} actual=${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
