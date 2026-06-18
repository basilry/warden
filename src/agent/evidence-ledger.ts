import { buildClaimGraph, type ClaimGraph } from "./claim-graph/index.ts";
import { hashPayload } from "./ids.ts";
import type { KnowledgeUnit } from "./types.ts";

export type EvidenceLedgerEntry = {
  id: string;
  knowledgeUnitId: string;
  sourceUri: string;
  sourceType: KnowledgeUnit["sourceType"];
  claimIds: string[];
  sourceClaimIds: string[];
  confidence: number;
  reliability: string;
  lineageRefs: string[];
  citedKnowledgeUnitIds: string[];
  citedSourceUris: string[];
};

export type EvidenceLineageEdge = {
  id: string;
  fromEntryId: string;
  toEntryId: string;
  fromSourceUri: string;
  toSourceUri: string;
  evidenceRef: string;
  claimIds: string[];
  sourceClaimIds: string[];
};

export type EvidenceLedger = {
  id: string;
  entries: EvidenceLedgerEntry[];
  lineageEdges: EvidenceLineageEdge[];
  sourceCount: number;
  claimCount: number;
};

export type EvidenceLedgerBuildOptions = {
  graph?: ClaimGraph;
  reliabilityFallback?: string;
};

export function buildEvidenceLedger(units: KnowledgeUnit[], options: EvidenceLedgerBuildOptions = {}): EvidenceLedger {
  const graph = options.graph ?? buildClaimGraph(units);
  const claimIdToNodeIds = buildClaimIdToNodeIds(graph);
  const entries = units.map((unit) => buildLedgerEntry(unit, units, claimIdToNodeIds, options)).sort(compareEntries);
  const lineageEdges = buildLineageEdges(units, entries, claimIdToNodeIds).sort(compareLineageEdges);
  const ledgerHash = hashPayload({
    entries: entries.map((entry) => ({
      knowledgeUnitId: entry.knowledgeUnitId,
      sourceUri: entry.sourceUri,
      claimIds: entry.claimIds,
      lineageRefs: entry.lineageRefs
    })),
    lineageEdges: lineageEdges.map((edge) => ({
      fromEntryId: edge.fromEntryId,
      toEntryId: edge.toEntryId,
      evidenceRef: edge.evidenceRef
    }))
  });

  return {
    id: `evidence_ledger_${ledgerHash.slice(0, 12)}`,
    entries,
    lineageEdges,
    sourceCount: entries.length,
    claimCount: entries.reduce((sum, entry) => sum + entry.sourceClaimIds.length, 0)
  };
}

function buildLedgerEntry(
  unit: KnowledgeUnit,
  allUnits: KnowledgeUnit[],
  claimIdToNodeIds: Map<string, string[]>,
  options: EvidenceLedgerBuildOptions
): EvidenceLedgerEntry {
  const sourceClaimIds = uniqueSorted(unit.claims.map((claim) => claim.id));
  const claimIds = uniqueSorted(sourceClaimIds.flatMap((claimId) => claimIdToNodeIds.get(claimId) ?? [claimId]));
  const evidenceRefs = unit.claims.flatMap((claim) => claim.evidenceRefs);
  const citedUnits = uniqueUnits(evidenceRefs.flatMap((ref) => resolveKnowledgeUnitRefs(allUnits, ref)));
  const lineageRefs = uniqueSorted([
    `source:${unit.sourceUri}`,
    unit.provenance.originalLocation ? `origin:${unit.provenance.originalLocation}` : "",
    `contentHash:${unit.provenance.contentHash}`,
    `parser:${unit.provenance.parserVersion}`,
    ...evidenceRefs
  ]);
  const entryHash = hashPayload({
    knowledgeUnitId: unit.id,
    sourceUri: unit.sourceUri,
    claimIds,
    lineageRefs
  });

  return {
    id: `ledger_entry_${entryHash.slice(0, 12)}`,
    knowledgeUnitId: unit.id,
    sourceUri: unit.sourceUri,
    sourceType: unit.sourceType,
    claimIds,
    sourceClaimIds,
    confidence: average(unit.claims.map((claim) => claim.confidence)),
    reliability: unit.reliability ?? options.reliabilityFallback ?? "unknown",
    lineageRefs,
    citedKnowledgeUnitIds: uniqueSorted(citedUnits.map((citedUnit) => citedUnit.id)),
    citedSourceUris: uniqueSorted(citedUnits.map((citedUnit) => citedUnit.sourceUri))
  };
}

function buildLineageEdges(
  units: KnowledgeUnit[],
  entries: EvidenceLedgerEntry[],
  claimIdToNodeIds: Map<string, string[]>
): EvidenceLineageEdge[] {
  const entryByUnitId = new Map(entries.map((entry) => [entry.knowledgeUnitId, entry]));
  const edges: EvidenceLineageEdge[] = [];

  for (const unit of units) {
    const fromEntry = entryByUnitId.get(unit.id);
    if (!fromEntry) continue;
    for (const claim of unit.claims) {
      for (const evidenceRef of claim.evidenceRefs) {
        for (const citedUnit of resolveKnowledgeUnitRefs(units, evidenceRef)) {
          const toEntry = entryByUnitId.get(citedUnit.id);
          if (!toEntry || toEntry.id === fromEntry.id) continue;
          const claimIds = claimIdToNodeIds.get(claim.id) ?? [claim.id];
          const edgeHash = hashPayload({
            fromEntryId: fromEntry.id,
            toEntryId: toEntry.id,
            evidenceRef,
            claimIds
          });
          edges.push({
            id: `ledger_lineage_${edgeHash.slice(0, 12)}`,
            fromEntryId: fromEntry.id,
            toEntryId: toEntry.id,
            fromSourceUri: fromEntry.sourceUri,
            toSourceUri: toEntry.sourceUri,
            evidenceRef,
            claimIds: uniqueSorted(claimIds),
            sourceClaimIds: [claim.id]
          });
        }
      }
    }
  }

  return dedupeLineageEdges(edges);
}

function buildClaimIdToNodeIds(graph: ClaimGraph): Map<string, string[]> {
  const byClaimId = new Map<string, string[]>();
  for (const node of graph.nodes) {
    for (const claimId of node.claimIds) {
      const nodeIds = byClaimId.get(claimId) ?? [];
      nodeIds.push(node.id);
      byClaimId.set(claimId, uniqueSorted(nodeIds));
    }
  }
  return byClaimId;
}

function resolveKnowledgeUnitRefs(units: KnowledgeUnit[], ref: string): KnowledgeUnit[] {
  const normalized = ref.replace(/^source:/, "").replace(/^ku:/, "");
  return units.filter(
    (unit) =>
      unit.id === ref ||
      unit.id === normalized ||
      unit.sourceUri === ref ||
      unit.sourceUri === normalized ||
      unit.provenance.originalLocation === ref ||
      unit.provenance.originalLocation === normalized
  );
}

function uniqueUnits(units: KnowledgeUnit[]): KnowledgeUnit[] {
  const byId = new Map<string, KnowledgeUnit>();
  for (const unit of units) {
    if (!byId.has(unit.id)) byId.set(unit.id, unit);
  }
  return Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + boundedConfidence(value), 0);
  return Math.round((sum / values.length) * 10000) / 10000;
}

function boundedConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function compareEntries(left: EvidenceLedgerEntry, right: EvidenceLedgerEntry): number {
  return `${left.knowledgeUnitId}:${left.sourceUri}`.localeCompare(`${right.knowledgeUnitId}:${right.sourceUri}`);
}

function compareLineageEdges(left: EvidenceLineageEdge, right: EvidenceLineageEdge): number {
  return `${left.fromEntryId}:${left.toEntryId}:${left.evidenceRef}`.localeCompare(
    `${right.fromEntryId}:${right.toEntryId}:${right.evidenceRef}`
  );
}

function dedupeLineageEdges(edges: EvidenceLineageEdge[]): EvidenceLineageEdge[] {
  const byKey = new Map<string, EvidenceLineageEdge>();
  for (const edge of edges) {
    const key = `${edge.fromEntryId}:${edge.toEntryId}:${edge.evidenceRef}:${edge.sourceClaimIds.join(",")}`;
    if (!byKey.has(key)) byKey.set(key, edge);
  }
  return Array.from(byKey.values());
}
