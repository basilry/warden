import { hashPayload } from "../ids.ts";
import type { Claim, KnowledgeUnit } from "../types.ts";

export type ClaimPolarity = "affirmed" | "negated" | "uncertain";

export type ClaimHintSet = {
  actors: string[];
  regions: string[];
  topics: string[];
  times: string[];
};

export type ClaimNodeFlag = "duplicate-source" | "contradicted" | "cites-source";

export type ClaimNode = {
  id: string;
  text: string;
  normalizedText: string;
  dedupeKey: string;
  polarity: ClaimPolarity;
  claimIds: string[];
  knowledgeUnitIds: string[];
  sourceUris: string[];
  evidenceRefs: string[];
  confidence: number;
  reliability: string[];
  hints: ClaimHintSet;
  tags: string[];
  flags: ClaimNodeFlag[];
};

export type ClaimEdgeKind = "contradicts" | "cites";

export type ClaimEdge = {
  id: string;
  kind: ClaimEdgeKind;
  from: string;
  to: string;
  confidence: number;
  reason: string;
  evidenceRefs: string[];
};

export type ClaimDuplicateGroup = {
  dedupeKey: string;
  claimIds: string[];
  nodeId: string;
};

export type ClaimGraph = {
  id: string;
  nodes: ClaimNode[];
  edges: ClaimEdge[];
  duplicateGroups: ClaimDuplicateGroup[];
  sourceUnitCount: number;
  rawClaimCount: number;
  canonicalClaimCount: number;
  contradictionCount: number;
};

export type ClaimGraphBuildOptions = {
  contradictionThreshold?: number;
};

type SourceClaimRecord = {
  claim: Claim;
  unit: KnowledgeUnit;
  normalizedText: string;
  dedupeKey: string;
  subjectKey: string;
  polarity: ClaimPolarity;
  hints: ClaimHintSet;
};

type MutableClaimNode = Omit<ClaimNode, "flags"> & {
  flags: Set<ClaimNodeFlag>;
  subjectKeys: string[];
};

const DEFAULT_CONTRADICTION_THRESHOLD = 0.54;

const TAG_HINT_PREFIXES = {
  actors: ["actor", "source_actor", "organization", "org"],
  regions: ["region", "country", "area", "theater"],
  topics: ["topic", "domain", "scenario", "sector", "capability"],
  times: ["time", "date", "year", "period", "as_of"]
} as const;

const ACTOR_HINTS = [
  ["People's Liberation Army", /\bpeople'?s liberation army\b/i],
  ["PLA", /\bpla\b/i],
  ["PRC", /\bprc\b/i],
  ["China", /\bchina\b|\bchinese\b|중국/i],
  ["Taiwan", /\btaiwan\b|대만/i],
  ["United States", /\bunited states\b|\bu\.s\.\b|\bus\b|미국/i],
  ["South Korea", /\bsouth korea\b|\brepublic of korea\b|대한민국|한국/i],
  ["North Korea", /\bnorth korea\b|\bdprk\b|북한/i],
  ["Japan", /\bjapan\b|일본/i],
  ["Russia", /\brussia\b|러시아/i],
  ["Iran", /\biran\b|이란/i],
  ["Supplier", /\bsupplier\b|\bvendor\b|\bmanufacturer\b|공급업체|제조사/i],
  ["Government", /\bgovernment\b|\bministry\b|\bagency\b|정부|부처|기관/i]
] as const;

const REGION_HINTS = [
  ["Taiwan", /\btaiwan\b|대만/i],
  ["Taiwan Strait", /\btaiwan strait\b|대만\s*해협/i],
  ["Northeast Asia", /\bnortheast asia\b|동북아/i],
  ["Korean Peninsula", /\bkorean peninsula\b|한반도/i],
  ["South Korea", /\bsouth korea\b|\brepublic of korea\b|대한민국|한국/i],
  ["North Korea", /\bnorth korea\b|\bdprk\b|북한/i],
  ["Japan", /\bjapan\b|일본/i],
  ["South China Sea", /\bsouth china sea\b|남중국해/i],
  ["Red Sea", /\bred sea\b|홍해/i],
  ["Europe", /\beurope\b|유럽/i]
] as const;

const TOPIC_HINTS = [
  ["invasion", /\binvasion\b|\binvade\b|\bamphibious\b|침공|상륙/i],
  ["blockade", /\bblockade\b|\bquarantine\b|\binspection\b|봉쇄|검문/i],
  ["military_activity", /\bmilitary\b|\bexercise\b|\bdrill\b|\bdeployment\b|군사|훈련|배치/i],
  ["supply_chain", /\bsupply chain\b|\bsupplier\b|\bimport\b|\bexport\b|공급망|수입|수출/i],
  ["semiconductor", /\bsemiconductor\b|\bchip\b|반도체/i],
  ["sanctions", /\bsanction\b|\bexport control\b|제재|수출통제/i],
  ["cyber", /\bcyber\b|\bmalware\b|\bintrusion\b|사이버|해킹/i],
  ["diplomacy", /\bdiplomatic\b|\bnegotiation\b|\btalks\b|외교|협상|회담/i],
  ["information_operation", /\bdisinformation\b|\bpropaganda\b|\binfluence\b|허위|선전|정보작전/i]
] as const;

const NEGATION_PATTERNS = [
  /\bno evidence of\b/i,
  /\bno confirmed\b/i,
  /\bnot observed\b/i,
  /\bdid not\b/i,
  /\bdoes not\b/i,
  /\bhas not\b/i,
  /\bhave not\b/i,
  /\bnot\b/i,
  /\bdenied\b/i,
  /\bdenies\b/i,
  /\brefuted\b/i,
  /\brefutes\b/i,
  /\babsent\b/i,
  /\bunlikely\b/i,
  /확인되지\s*않았다/g,
  /확인되지/g,
  /없다/g,
  /부인/g,
  /아니다/g,
  /미확인/g,
  /가능성\s*낮/g
];

const UNCERTAINTY_PATTERNS = [
  /\bmay\b/i,
  /\bmight\b/i,
  /\bcould\b/i,
  /\bpossible\b/i,
  /\bunconfirmed\b/i,
  /\bpreliminary\b/i,
  /가능성/i,
  /추정/i,
  /예비/i
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "near",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "was",
  "were",
  "with",
  "지난",
  "관련",
  "관측",
  "보고",
  "확인"
]);

export function buildClaimGraph(units: KnowledgeUnit[], options: ClaimGraphBuildOptions = {}): ClaimGraph {
  const records = units.flatMap((unit) => extractClaimRecords(unit));
  const grouped = groupRecordsByDedupeKey(records);
  const mutableNodes = Array.from(grouped.values()).map(buildMutableNode);
  const edges = buildGraphEdges(mutableNodes, units, options);
  const nodes = mutableNodes
    .map(finalizeNode)
    .sort((left, right) => left.id.localeCompare(right.id));
  const duplicateGroups = nodes
    .filter((node) => node.claimIds.length > 1)
    .map((node) => ({
      dedupeKey: node.dedupeKey,
      claimIds: [...node.claimIds],
      nodeId: node.id
    }))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const graphHash = hashPayload({
    nodes: nodes.map((node) => ({
      id: node.id,
      claimIds: node.claimIds,
      evidenceRefs: node.evidenceRefs
    })),
    edges: edges.map((edge) => ({
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
      evidenceRefs: edge.evidenceRefs
    }))
  });

  return {
    id: `claim_graph_${graphHash.slice(0, 12)}`,
    nodes,
    edges,
    duplicateGroups,
    sourceUnitCount: units.length,
    rawClaimCount: records.length,
    canonicalClaimCount: nodes.length,
    contradictionCount: edges.filter((edge) => edge.kind === "contradicts").length
  };
}

export function normalizeClaimText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/['']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractClaimHints(unit: KnowledgeUnit, claimText: string): ClaimHintSet {
  return {
    actors: uniqueSorted([...extractTagHints(unit.tags, TAG_HINT_PREFIXES.actors), ...extractRegexHints(claimText, ACTOR_HINTS)]),
    regions: uniqueSorted([...extractTagHints(unit.tags, TAG_HINT_PREFIXES.regions), ...extractRegexHints(claimText, REGION_HINTS)]),
    topics: uniqueSorted([...extractTagHints(unit.tags, TAG_HINT_PREFIXES.topics), ...extractRegexHints(claimText, TOPIC_HINTS)]),
    times: uniqueSorted([...extractTagHints(unit.tags, TAG_HINT_PREFIXES.times), ...extractTimeHints(claimText)])
  };
}

export function detectClaimPolarity(text: string): ClaimPolarity {
  if (NEGATION_PATTERNS.some((pattern) => pattern.test(text))) return "negated";
  if (UNCERTAINTY_PATTERNS.some((pattern) => pattern.test(text))) return "uncertain";
  return "affirmed";
}

function extractClaimRecords(unit: KnowledgeUnit): SourceClaimRecord[] {
  return unit.claims
    .filter((claim) => claim.text.trim().length > 0)
    .map((claim) => {
      const normalizedText = normalizeClaimText(claim.text);
      return {
        claim,
        unit,
        normalizedText,
        dedupeKey: normalizedText,
        subjectKey: buildSubjectKey(claim.text),
        polarity: detectClaimPolarity(claim.text),
        hints: extractClaimHints(unit, claim.text)
      };
    });
}

function groupRecordsByDedupeKey(records: SourceClaimRecord[]): Map<string, SourceClaimRecord[]> {
  const grouped = new Map<string, SourceClaimRecord[]>();
  for (const record of records.sort(compareRecords)) {
    const group = grouped.get(record.dedupeKey) ?? [];
    group.push(record);
    grouped.set(record.dedupeKey, group);
  }
  return grouped;
}

function buildMutableNode(records: SourceClaimRecord[]): MutableClaimNode {
  const canonical = selectCanonicalRecord(records);
  const confidence = average(records.map((record) => boundedConfidence(record.claim.confidence)));
  const nodeHash = hashPayload({ dedupeKey: canonical.dedupeKey });
  const flags = new Set<ClaimNodeFlag>();
  if (records.length > 1) flags.add("duplicate-source");

  return {
    id: `claim_node_${nodeHash.slice(0, 12)}`,
    text: canonical.claim.text.trim(),
    normalizedText: canonical.normalizedText,
    dedupeKey: canonical.dedupeKey,
    polarity: resolveGroupPolarity(records),
    claimIds: uniqueSorted(records.map((record) => record.claim.id)),
    knowledgeUnitIds: uniqueSorted(records.map((record) => record.unit.id)),
    sourceUris: uniqueSorted(records.map((record) => record.unit.sourceUri)),
    evidenceRefs: uniqueSorted(records.flatMap((record) => record.claim.evidenceRefs)),
    confidence,
    reliability: uniqueSorted(records.flatMap((record) => (record.unit.reliability ? [record.unit.reliability] : []))),
    hints: mergeHints(records.map((record) => record.hints)),
    tags: uniqueSorted(records.flatMap((record) => record.unit.tags)),
    flags,
    subjectKeys: uniqueSorted(records.map((record) => record.subjectKey).filter((key) => key.length > 0))
  };
}

function buildGraphEdges(nodes: MutableClaimNode[], units: KnowledgeUnit[], options: ClaimGraphBuildOptions): ClaimEdge[] {
  const contradictionEdges = buildContradictionEdges(nodes, options.contradictionThreshold ?? DEFAULT_CONTRADICTION_THRESHOLD);
  const citationEdges = buildCitationEdges(nodes, units);
  return dedupeEdges([...contradictionEdges, ...citationEdges]).sort(compareEdges);
}

function buildContradictionEdges(nodes: MutableClaimNode[], threshold: number): ClaimEdge[] {
  const edges: ClaimEdge[] = [];
  const sortedNodes = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  for (let leftIndex = 0; leftIndex < sortedNodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sortedNodes.length; rightIndex += 1) {
      const left = sortedNodes[leftIndex];
      const right = sortedNodes[rightIndex];
      if (!hasOpposingPolarity(left, right)) continue;
      const score = contradictionSimilarity(left, right);
      if (score < threshold) continue;
      left.flags.add("contradicted");
      right.flags.add("contradicted");
      const [from, to] = left.polarity === "negated" ? [left, right] : [right, left];
      const edgeHash = hashPayload({ kind: "contradicts", from: from.id, to: to.id, score });
      edges.push({
        id: `claim_edge_${edgeHash.slice(0, 12)}`,
        kind: "contradicts",
        from: from.id,
        to: to.id,
        confidence: roundScore(Math.min(0.95, 0.45 + score / 2)),
        reason: "opposing polarity with overlapping normalized subject and matching hints",
        evidenceRefs: uniqueSorted([...from.evidenceRefs, ...to.evidenceRefs])
      });
    }
  }
  return edges;
}

function buildCitationEdges(nodes: MutableClaimNode[], units: KnowledgeUnit[]): ClaimEdge[] {
  const edges: ClaimEdge[] = [];
  const nodeByUnitId = new Map<string, MutableClaimNode[]>();
  for (const node of nodes) {
    for (const unitId of node.knowledgeUnitIds) {
      const unitNodes = nodeByUnitId.get(unitId) ?? [];
      unitNodes.push(node);
      nodeByUnitId.set(unitId, unitNodes);
    }
  }

  for (const unit of units) {
    const sourceNodes = nodeByUnitId.get(unit.id) ?? [];
    for (const claim of unit.claims) {
      for (const ref of claim.evidenceRefs) {
        for (const citedUnit of resolveKnowledgeUnitRefs(units, ref)) {
          const targetNodes = nodeByUnitId.get(citedUnit.id) ?? [];
          for (const sourceNode of sourceNodes) {
            if (!sourceNode.claimIds.includes(claim.id)) continue;
            for (const targetNode of targetNodes) {
              if (sourceNode.id === targetNode.id) continue;
              sourceNode.flags.add("cites-source");
              const edgeHash = hashPayload({
                kind: "cites",
                from: sourceNode.id,
                to: targetNode.id,
                ref
              });
              edges.push({
                id: `claim_edge_${edgeHash.slice(0, 12)}`,
                kind: "cites",
                from: sourceNode.id,
                to: targetNode.id,
                confidence: 0.8,
                reason: "claim evidence reference resolves to another KnowledgeUnit",
                evidenceRefs: [ref]
              });
            }
          }
        }
      }
    }
  }
  return edges;
}

function finalizeNode(node: MutableClaimNode): ClaimNode {
  return {
    id: node.id,
    text: node.text,
    normalizedText: node.normalizedText,
    dedupeKey: node.dedupeKey,
    polarity: node.polarity,
    claimIds: [...node.claimIds],
    knowledgeUnitIds: [...node.knowledgeUnitIds],
    sourceUris: [...node.sourceUris],
    evidenceRefs: [...node.evidenceRefs],
    confidence: node.confidence,
    reliability: [...node.reliability],
    hints: {
      actors: [...node.hints.actors],
      regions: [...node.hints.regions],
      topics: [...node.hints.topics],
      times: [...node.hints.times]
    },
    tags: [...node.tags],
    flags: Array.from(node.flags).sort()
  };
}

function selectCanonicalRecord(records: SourceClaimRecord[]): SourceClaimRecord {
  return [...records].sort((left, right) => {
    const confidenceDiff = boundedConfidence(right.claim.confidence) - boundedConfidence(left.claim.confidence);
    if (confidenceDiff !== 0) return confidenceDiff;
    const lengthDiff = left.claim.text.length - right.claim.text.length;
    if (lengthDiff !== 0) return lengthDiff;
    return compareRecords(left, right);
  })[0];
}

function resolveGroupPolarity(records: SourceClaimRecord[]): ClaimPolarity {
  const counts = records.reduce<Record<ClaimPolarity, number>>(
    (acc, record) => {
      acc[record.polarity] += 1;
      return acc;
    },
    { affirmed: 0, negated: 0, uncertain: 0 }
  );
  if (counts.negated > counts.affirmed && counts.negated >= counts.uncertain) return "negated";
  if (counts.affirmed >= counts.negated && counts.affirmed >= counts.uncertain) return "affirmed";
  return "uncertain";
}

function buildSubjectKey(text: string): string {
  let subject = normalizeClaimText(text);
  for (const pattern of NEGATION_PATTERNS) {
    subject = subject.replace(pattern, " ");
  }
  return subject
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .join(" ")
    .trim();
}

function contradictionSimilarity(left: MutableClaimNode, right: MutableClaimNode): number {
  const subjectOverlap = maxTokenJaccard(left.subjectKeys, right.subjectKeys);
  const actorBoost = hasSharedHint(left.hints.actors, right.hints.actors) ? 0.12 : 0;
  const regionBoost = hasSharedHint(left.hints.regions, right.hints.regions) ? 0.12 : 0;
  const topicBoost = hasSharedHint(left.hints.topics, right.hints.topics) ? 0.08 : 0;
  return Math.min(1, subjectOverlap + actorBoost + regionBoost + topicBoost);
}

function maxTokenJaccard(leftKeys: string[], rightKeys: string[]): number {
  let best = 0;
  for (const left of leftKeys) {
    for (const right of rightKeys) {
      best = Math.max(best, tokenJaccard(left, right));
    }
  }
  return best;
}

function tokenJaccard(left: string, right: string): number {
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function hasOpposingPolarity(left: MutableClaimNode, right: MutableClaimNode): boolean {
  return (
    (left.polarity === "affirmed" && right.polarity === "negated") ||
    (left.polarity === "negated" && right.polarity === "affirmed")
  );
}

function hasSharedHint(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return left.some((item) => rightSet.has(item.toLowerCase()));
}

function extractTagHints(tags: string[], prefixes: readonly string[]): string[] {
  return tags.flatMap((tag) => {
    const index = tag.indexOf(":");
    if (index <= 0) return [];
    const prefix = tag.slice(0, index).trim().toLowerCase();
    if (!prefixes.includes(prefix)) return [];
    const value = tag.slice(index + 1).trim();
    return value.length > 0 ? [humanizeHint(value)] : [];
  });
}

function extractRegexHints(text: string, hints: readonly (readonly [string, RegExp])[]): string[] {
  return hints.flatMap(([label, pattern]) => (pattern.test(text) ? [label] : []));
}

function extractTimeHints(text: string): string[] {
  const matches = [
    ...text.matchAll(/\b20\d{2}(?:-[01]\d(?:-[0-3]\d)?)?\b/g),
    ...text.matchAll(/\bQ[1-4]\s+20\d{2}\b/gi),
    ...text.matchAll(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b/gi)
  ];
  return matches.map((match) => match[0]);
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

function mergeHints(hints: ClaimHintSet[]): ClaimHintSet {
  return {
    actors: uniqueSorted(hints.flatMap((hint) => hint.actors)),
    regions: uniqueSorted(hints.flatMap((hint) => hint.regions)),
    topics: uniqueSorted(hints.flatMap((hint) => hint.topics)),
    times: uniqueSorted(hints.flatMap((hint) => hint.times))
  };
}

function boundedConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return roundScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function humanizeHint(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function compareRecords(left: SourceClaimRecord, right: SourceClaimRecord): number {
  return `${left.unit.id}:${left.claim.id}:${left.normalizedText}`.localeCompare(`${right.unit.id}:${right.claim.id}:${right.normalizedText}`);
}

function compareEdges(left: ClaimEdge, right: ClaimEdge): number {
  return `${left.kind}:${left.from}:${left.to}:${left.evidenceRefs.join(",")}`.localeCompare(
    `${right.kind}:${right.from}:${right.to}:${right.evidenceRefs.join(",")}`
  );
}

function dedupeEdges(edges: ClaimEdge[]): ClaimEdge[] {
  const byKey = new Map<string, ClaimEdge>();
  for (const edge of edges) {
    const key = `${edge.kind}:${edge.from}:${edge.to}:${edge.evidenceRefs.join(",")}`;
    if (!byKey.has(key)) byKey.set(key, edge);
  }
  return Array.from(byKey.values());
}
