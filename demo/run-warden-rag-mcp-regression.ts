import { dispatchRagToolCall, dispatchUnknownRagToolCall } from "../src/mcp/rag/tools.ts";
import { getRagMcpToolRisk } from "../src/mcp/rag/types.ts";

const taiwan = dispatchRagToolCall("retrieve_context", {
  query: "Taiwan security risk to semiconductor supply",
  limit: 3
});
assertAtLeast(taiwan.units.length, 2, "Taiwan retrieval unit count");
assertEqual(taiwan.result.units.length, taiwan.units.length, "KnowledgeUnit alias count");
assertSomeUnitHasTag(taiwan.units, "region:taiwan", "Taiwan retrieval region tag");
assertSomeUnitHasTag(taiwan.units, "topic:security", "Taiwan retrieval security tag");
assertSomeUnitClaimIncludes(taiwan.units, "Taiwan security pressure", "Taiwan retrieval claim");
assertKnowledgeUnits(taiwan.units, "Taiwan retrieval KnowledgeUnits");

const northeastAsia = dispatchRagToolCall("retrieve_context", {
  query: "Northeast Asia supply-chain dependencies and industrial resilience",
  limit: 3,
  requiredTags: ["region:northeast_asia"]
});
assertAtLeast(northeastAsia.units.length, 2, "Northeast Asia retrieval unit count");
assertSomeUnitHasTag(northeastAsia.units, "topic:supply_chain", "Northeast Asia supply-chain tag");
assertSomeUnitClaimIncludes(northeastAsia.units, "Northeast Asia supply-chain analysis", "Northeast Asia claim");
assertKnowledgeUnits(northeastAsia.units, "Northeast Asia retrieval KnowledgeUnits");

const summary = dispatchRagToolCall("summarize_corpus", {});
assertEqual(summary.summary.corpusId, "p21-local-domain-corpus-v1", "summary corpus id");
assertAtLeast(summary.summary.unitCount, 4, "summary unit count");
assertIncludes(summary.summary.tags, "region:taiwan", "summary Taiwan tag");
assertIncludes(summary.summary.tags, "topic:supply_chain", "summary supply-chain tag");
assertEqual(getRagMcpToolRisk("retrieve_context"), "READ", "retrieve_context risk");
assertEqual(getRagMcpToolRisk("summarize_corpus"), "READ", "summarize_corpus risk");

assertRejects(() => dispatchUnknownRagToolCall("web_search", { query: "Taiwan" }), "unknown RAG MCP tool");

console.log("WARDEN RAG MCP regression: passed");

function assertKnowledgeUnits(units: typeof taiwan.units, label: string): void {
  for (const unit of units) {
    assertIncludes(["fixture", "pdf", "html", "api", "manual", "report"], unit.sourceType, `${label} sourceType`);
    if (!unit.id || !unit.sourceUri || !unit.extractedAt) {
      throw new Error(`${label} has incomplete KnowledgeUnit identity.`);
    }
    if (unit.claims.length === 0) {
      throw new Error(`${label} KnowledgeUnit ${unit.id} has no claims.`);
    }
    if (unit.provenance.capturedBy !== "agent" || !unit.provenance.contentHash) {
      throw new Error(`${label} KnowledgeUnit ${unit.id} has invalid provenance.`);
    }
  }
}

function assertRejects(fn: () => unknown, label: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label}: expected rejection`);
}

function assertSomeUnitHasTag(units: Array<{ tags: string[] }>, expected: string, label: string): void {
  if (!units.some((unit) => unit.tags.includes(expected))) {
    throw new Error(`${label} missing ${expected}.`);
  }
}

function assertSomeUnitClaimIncludes(
  units: Array<{ claims: Array<{ text: string }> }>,
  expected: string,
  label: string
): void {
  if (!units.some((unit) => unit.claims.some((claim) => claim.text.includes(expected)))) {
    throw new Error(`${label} missing expected claim text: ${expected}`);
  }
}

function assertIncludes<T>(items: T[], expected: T, label: string): void {
  if (!items.includes(expected)) {
    throw new Error(`${label} missing ${String(expected)} in ${items.map(String).join(", ")}`);
  }
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) {
    throw new Error(`${label} failed: expected at least ${expected} actual=${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
