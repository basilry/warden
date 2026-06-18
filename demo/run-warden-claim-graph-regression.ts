import { buildClaimGraph, type ClaimEdge, type ClaimNode } from "../src/agent/claim-graph/index.ts";
import { buildEvidenceLedger } from "../src/agent/evidence-ledger.ts";
import { hashPayload } from "../src/agent/ids.ts";
import type { KnowledgeUnit } from "../src/agent/types.ts";

const units: KnowledgeUnit[] = [
  makeUnit({
    id: "ku-source-a",
    sourceUri: "fixture://claim-graph/source-a",
    reliability: "A2",
    tags: ["actor:PLA", "region:taiwan", "topic:military_activity", "time:2026"],
    claims: [
      {
        id: "claim-source-a-1",
        text: "The PLA increased amphibious ship deployments near Taiwan in 2026.",
        confidence: 0.91,
        evidenceRefs: ["satellite-row-7"]
      }
    ]
  }),
  makeUnit({
    id: "ku-source-b",
    sourceUri: "fixture://claim-graph/source-b",
    reliability: "B2",
    tags: ["actor:PLA", "region:taiwan", "topic:military_activity", "time:2026"],
    claims: [
      {
        id: "claim-source-b-1",
        text: "the pla increased amphibious ship deployments near taiwan in 2026",
        confidence: 0.87,
        evidenceRefs: ["ku-baseline"]
      }
    ]
  }),
  makeUnit({
    id: "ku-counterclaim",
    sourceUri: "fixture://claim-graph/counterclaim",
    reliability: "C3",
    tags: ["actor:PLA", "region:taiwan", "topic:military_activity", "time:2026"],
    claims: [
      {
        id: "claim-counter-1",
        text: "The PLA did not increase amphibious ship deployments near Taiwan in 2026.",
        confidence: 0.74,
        evidenceRefs: ["assessment-note-2"]
      }
    ]
  }),
  makeUnit({
    id: "ku-baseline",
    sourceUri: "fixture://claim-graph/baseline-log",
    reliability: "A1",
    tags: ["lineage", "topic:collection_log", "time:2026"],
    claims: [
      {
        id: "claim-baseline-1",
        text: "The 2026 maritime collection log is the cited source for Source B.",
        confidence: 0.8,
        evidenceRefs: ["collection-log-row-12"]
      }
    ]
  })
];

const graph = buildClaimGraph(units);
assertEqual(graph.rawClaimCount, 4, "raw claim count");
assertEqual(graph.canonicalClaimCount, 3, "same-claim dedupe canonical count");
assertEqual(graph.duplicateGroups.length, 1, "duplicate group count");
assertArrayIncludes(graph.duplicateGroups[0].claimIds, "claim-source-a-1", "duplicate group source A");
assertArrayIncludes(graph.duplicateGroups[0].claimIds, "claim-source-b-1", "duplicate group source B");

const duplicateNode = requireNode(graph.nodes, "claim-source-a-1");
assertArrayIncludes(duplicateNode.claimIds, "claim-source-b-1", "deduped node retains source B claim id");
assertArrayIncludes(duplicateNode.flags, "duplicate-source", "duplicate node flag");
assertArrayIncludes(duplicateNode.hints.actors, "PLA", "actor hint");
assertArrayIncludes(duplicateNode.hints.regions, "Taiwan", "region hint");
assertArrayIncludes(duplicateNode.hints.times, "2026", "time hint");
assertIncludes(duplicateNode.hints.topics.join("\n"), "military", "topic hint");

const contradictionEdges = graph.edges.filter((edge) => edge.kind === "contradicts");
assertEqual(contradictionEdges.length, 1, "contradiction edge count");
const contradictionEdge = contradictionEdges[0];
assertEdgeTouches(contradictionEdge, duplicateNode.id, "contradiction touches duplicate node");
assertEdgeTouches(contradictionEdge, requireNode(graph.nodes, "claim-counter-1").id, "contradiction touches counterclaim");
assertArrayIncludes(duplicateNode.flags, "contradicted", "duplicate contradiction flag");
assertArrayIncludes(requireNode(graph.nodes, "claim-counter-1").flags, "contradicted", "counterclaim contradiction flag");

const citationEdges = graph.edges.filter((edge) => edge.kind === "cites");
assertEqual(citationEdges.length, 1, "graph citation edge count");
assertArrayIncludes(citationEdges[0].evidenceRefs, "ku-baseline", "graph citation evidence ref");
assertEdgeTouches(citationEdges[0], duplicateNode.id, "graph citation source node");
assertEdgeTouches(citationEdges[0], requireNode(graph.nodes, "claim-baseline-1").id, "graph citation target node");

const ledger = buildEvidenceLedger(units, { graph });
assertEqual(ledger.entries.length, 4, "ledger entry count");
assertEqual(ledger.lineageEdges.length, 1, "ledger lineage edge count");

const sourceBEntry = requireLedgerEntry("ku-source-b");
assertEqual(sourceBEntry.sourceUri, "fixture://claim-graph/source-b", "ledger source URI");
assertArrayIncludes(sourceBEntry.claimIds, duplicateNode.id, "ledger canonical claim id");
assertArrayIncludes(sourceBEntry.sourceClaimIds, "claim-source-b-1", "ledger source claim id");
assertEqual(sourceBEntry.confidence, 0.87, "ledger confidence");
assertEqual(sourceBEntry.reliability, "B2", "ledger reliability");
assertArrayIncludes(sourceBEntry.lineageRefs, "ku-baseline", "ledger evidence lineage ref");
assertArrayIncludes(sourceBEntry.citedKnowledgeUnitIds, "ku-baseline", "ledger cited unit");
assertArrayIncludes(sourceBEntry.citedSourceUris, "fixture://claim-graph/baseline-log", "ledger cited source URI");

const baselineEntry = requireLedgerEntry("ku-baseline");
const lineageEdge = ledger.lineageEdges[0];
assertEqual(lineageEdge.fromEntryId, sourceBEntry.id, "lineage from source B");
assertEqual(lineageEdge.toEntryId, baselineEntry.id, "lineage to baseline");
assertEqual(lineageEdge.evidenceRef, "ku-baseline", "lineage evidence ref");
assertArrayIncludes(lineageEdge.claimIds, duplicateNode.id, "lineage canonical claim id");

console.log("WARDEN claim graph regression: passed");

function makeUnit(input: {
  id: string;
  sourceUri: string;
  reliability: string;
  tags: string[];
  claims: KnowledgeUnit["claims"];
}): KnowledgeUnit {
  return {
    id: input.id,
    sourceUri: input.sourceUri,
    sourceType: "fixture",
    extractedAt: "2026-06-18T00:00:00.000Z",
    claims: input.claims,
    provenance: {
      capturedBy: "agent",
      originalLocation: input.sourceUri,
      contentHash: hashPayload({ id: input.id, claims: input.claims }),
      parserVersion: "p23-claim-graph-regression-v1"
    },
    reliability: input.reliability,
    tags: input.tags
  };
}

function requireNode(nodes: ClaimNode[], sourceClaimId: string): ClaimNode {
  const node = nodes.find((item) => item.claimIds.includes(sourceClaimId));
  if (!node) {
    throw new Error(`missing claim node for ${sourceClaimId}`);
  }
  return node;
}

function requireLedgerEntry(knowledgeUnitId: string): (typeof ledger.entries)[number] {
  const entry = ledger.entries.find((item) => item.knowledgeUnitId === knowledgeUnitId);
  if (!entry) {
    throw new Error(`missing ledger entry for ${knowledgeUnitId}`);
  }
  return entry;
}

function assertEdgeTouches(edge: ClaimEdge, nodeId: string, label: string): void {
  if (edge.from !== nodeId && edge.to !== nodeId) {
    throw new Error(`${label} failed: edge ${edge.id} did not touch ${nodeId}`);
  }
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertArrayIncludes(values: string[], expected: string, label: string): void {
  if (!values.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${values.join("\n")}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
