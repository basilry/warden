import { hashPayload } from "../ids.ts";
import type { Claim, KnowledgeUnit } from "../types.ts";
import type {
  SourceAssessment,
  SourceCorroborationClaim,
  SourceCorroborationResult,
  SourceLineageCycle,
  SourceLineageEdge,
  SourceRecord,
  SourceReport,
  SourceReview,
  SourceRiskFlag,
  SourceVetRegistry
} from "../sourcevet-types.ts";

export type SourceVetLocalTool = {
  createRegistry(): SourceVetRegistry;
  registerSourceFromKnowledgeUnit(registry: SourceVetRegistry, unit: KnowledgeUnit): SourceVetRegistry;
  addReportFromClaim(registry: SourceVetRegistry, sourceId: string, claim: Claim): SourceVetRegistry;
  assessSource(registry: SourceVetRegistry, sourceId: string): SourceAssessment;
  computeFabricationRisk(registry: SourceVetRegistry, sourceId?: string): number;
  detectCircularLineage(registry: SourceVetRegistry): SourceLineageCycle[];
  detectIndependentCorroboration(registry: SourceVetRegistry, minIndependentSources?: number): SourceCorroborationResult;
  reviewKnowledgeUnits(units: KnowledgeUnit[], options?: SourceVetReviewOptions): SourceReview;
};

export type SourceVetReviewOptions = {
  minIndependentSources?: number;
};

const DEFAULT_MIN_INDEPENDENT_SOURCES = 2;

export function createSourceVetLocalTool(): SourceVetLocalTool {
  return {
    createRegistry,
    registerSourceFromKnowledgeUnit,
    addReportFromClaim,
    assessSource,
    computeFabricationRisk,
    detectCircularLineage,
    detectIndependentCorroboration,
    reviewKnowledgeUnits
  };
}

export function createRegistry(): SourceVetRegistry {
  return { sources: [], reports: [] };
}

export function registerSourceFromKnowledgeUnit(registry: SourceVetRegistry, unit: KnowledgeUnit): SourceVetRegistry {
  if (!unit.id || !unit.sourceUri) {
    throw new Error("SourceVet rejected KnowledgeUnit: id and sourceUri are required.");
  }
  if (registry.sources.some((source) => source.id === unit.id)) {
    throw new Error(`SourceVet rejected KnowledgeUnit ${unit.id}: duplicate source id.`);
  }

  const source: SourceRecord = {
    id: unit.id,
    sourceUri: unit.sourceUri,
    sourceType: unit.sourceType,
    reliability: unit.reliability,
    provenance: { ...unit.provenance },
    tags: [...unit.tags],
    claims: unit.claims.map((claim) => ({
      ...claim,
      evidenceRefs: [...claim.evidenceRefs]
    }))
  };

  return {
    ...registry,
    sources: [...registry.sources, source]
  };
}

export function addReportFromClaim(registry: SourceVetRegistry, sourceId: string, claim: Claim): SourceVetRegistry {
  const source = findSource(registry, sourceId);
  const citedSourceIds = unique(
    claim.evidenceRefs.flatMap((ref) => resolveSourceRef(registry, ref)).filter((id) => registry.sources.some((item) => item.id === id))
  );
  const contentHash = hashPayload({
    sourceId,
    claimId: claim.id,
    text: claim.text,
    confidence: claim.confidence,
    evidenceRefs: claim.evidenceRefs
  });
  const report: SourceReport = {
    id: `svr_${contentHash.slice(0, 12)}`,
    sourceId: source.id,
    claimId: claim.id,
    text: claim.text,
    normalizedText: normalizeClaimText(claim.text),
    confidence: claim.confidence,
    evidenceRefs: [...claim.evidenceRefs],
    citedSourceIds,
    contentHash
  };

  return {
    ...registry,
    reports: [...registry.reports, report]
  };
}

export function assessSource(registry: SourceVetRegistry, sourceId: string): SourceAssessment {
  const source = findSource(registry, sourceId);
  const reports = registry.reports.filter((report) => report.sourceId === sourceId);
  const citedSourceIds = unique(reports.flatMap((report) => report.citedSourceIds)).sort();
  const flags: SourceRiskFlag[] = [];

  if (!isValidReliability(source.reliability)) {
    flags.push({
      code: "missing-reliability",
      severity: "high",
      sourceId,
      summary: `${sourceId} lacks a valid Admiralty reliability code.`,
      evidenceRefs: [source.sourceUri]
    });
  } else if (reliabilityRisk(source.reliability) >= 0.5) {
    flags.push({
      code: "low-reliability",
      severity: "medium",
      sourceId,
      summary: `${sourceId} has weak reliability code ${source.reliability}.`,
      evidenceRefs: [source.sourceUri]
    });
  }

  if (!source.provenance.contentHash || !source.provenance.parserVersion) {
    flags.push({
      code: "missing-provenance",
      severity: "high",
      sourceId,
      summary: `${sourceId} is missing deterministic provenance fields.`,
      evidenceRefs: [source.sourceUri]
    });
  }

  for (const report of reports.filter((item) => item.confidence < 0.5)) {
    flags.push({
      code: "weak-claim-confidence",
      severity: "medium",
      sourceId,
      claimId: report.claimId,
      summary: `${report.claimId} has low extraction confidence ${report.confidence}.`,
      evidenceRefs: report.evidenceRefs
    });
  }

  if (source.sourceType === "fixture") {
    flags.push({
      code: "fixture-source",
      severity: "info",
      sourceId,
      summary: `${sourceId} is fixture-backed and should not be promoted to operational evidence.`,
      evidenceRefs: [source.sourceUri]
    });
  }

  if (source.sourceType === "report") {
    flags.push({
      code: "report-source",
      severity: "low",
      sourceId,
      summary: `${sourceId} is a report source and may restate upstream reporting.`,
      evidenceRefs: [source.sourceUri]
    });
  }

  for (const cycle of detectCircularLineage(registry).filter((item) => item.sourceIds.includes(sourceId))) {
    flags.push({
      code: "circular-lineage",
      severity: "critical",
      sourceId,
      summary: cycle.summary,
      evidenceRefs: cycle.edges.map((edge) => edge.evidenceRef)
    });
  }

  const corroboration = detectIndependentCorroboration(registry);
  for (const claim of corroboration.requiredClaims.filter((item) => item.sourceId === sourceId)) {
    flags.push({
      code: "independent-corroboration-required",
      severity: "high",
      sourceId,
      claimId: claim.claimId,
      summary: claim.reason,
      evidenceRefs: reports.find((report) => report.claimId === claim.claimId)?.evidenceRefs ?? []
    });
  }

  const riskScore = computeFabricationRisk(registry, sourceId);
  if (riskScore >= 0.7) {
    flags.push({
      code: "possible-fabrication",
      severity: "high",
      sourceId,
      summary: `${sourceId} has fabrication risk ${riskScore}.`,
      evidenceRefs: [source.sourceUri]
    });
  }

  return {
    sourceId,
    sourceUri: source.sourceUri,
    sourceType: source.sourceType,
    reliability: source.reliability,
    claimCount: reports.length,
    citedSourceIds,
    riskScore,
    flags: uniqueFlags(flags)
  };
}

export function computeFabricationRisk(registry: SourceVetRegistry, sourceId?: string): number {
  const circularSourceIds = new Set(detectCircularLineage(registry).flatMap((cycle) => cycle.sourceIds));
  const requiredClaimSourceIds = new Set(detectIndependentCorroboration(registry).requiredClaims.map((claim) => claim.sourceId));
  const selectedSources = sourceId ? [findSource(registry, sourceId)] : [...registry.sources];
  if (selectedSources.length === 0) return 0;

  const risks = selectedSources.map((source) => {
    const reports = registry.reports.filter((report) => report.sourceId === source.id);
    const averageConfidence =
      reports.length === 0 ? 0 : reports.reduce((sum, report) => sum + report.confidence, 0) / reports.length;
    let risk = 0.05;

    risk += isValidReliability(source.reliability) ? reliabilityRisk(source.reliability) * 0.35 : 0.3;
    if (!source.provenance.contentHash || !source.provenance.parserVersion) risk += 0.2;
    if (source.sourceType === "manual") risk += 0.1;
    if (source.sourceType === "report") risk += 0.08;
    if (source.sourceType === "fixture") risk += 0.03;
    if (averageConfidence < 0.5) risk += 0.2;
    else if (averageConfidence < 0.7) risk += 0.1;
    if (circularSourceIds.has(source.id)) risk += 0.35;
    if (requiredClaimSourceIds.has(source.id)) risk += 0.18;

    return Math.min(risk, 1);
  });

  return round(risks.reduce((sum, risk) => sum + risk, 0) / risks.length);
}

export function detectCircularLineage(registry: SourceVetRegistry): SourceLineageCycle[] {
  const edges = buildLineageEdges(registry);
  const graph = new Map<string, SourceLineageEdge[]>();
  for (const edge of edges) {
    graph.set(edge.fromSourceId, [...(graph.get(edge.fromSourceId) ?? []), edge]);
  }

  const cycles: SourceLineageCycle[] = [];
  const seen = new Set<string>();
  const sourceIds = registry.sources.map((source) => source.id).sort();

  for (const startSourceId of sourceIds) {
    walkLineage(startSourceId, startSourceId, [], new Set([startSourceId]));
  }

  return cycles.sort((a, b) => a.sourceIds.join("|").localeCompare(b.sourceIds.join("|")));

  function walkLineage(startSourceId: string, currentSourceId: string, path: SourceLineageEdge[], visited: Set<string>): void {
    const nextEdges = [...(graph.get(currentSourceId) ?? [])].sort((a, b) => a.toSourceId.localeCompare(b.toSourceId));
    for (const edge of nextEdges) {
      if (edge.toSourceId === startSourceId) {
        const cycleEdges = [...path, edge];
        const sourcePath = [cycleEdges[0].fromSourceId, ...cycleEdges.map((item) => item.toSourceId)];
        const key = canonicalCycleKey(sourcePath);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push({
            sourceIds: sourcePath,
            edges: cycleEdges,
            summary: `Circular source lineage detected: ${sourcePath.join(" -> ")}.`
          });
        }
        continue;
      }
      if (!visited.has(edge.toSourceId)) {
        walkLineage(startSourceId, edge.toSourceId, [...path, edge], new Set([...visited, edge.toSourceId]));
      }
    }
  }
}

export function detectIndependentCorroboration(
  registry: SourceVetRegistry,
  minIndependentSources = DEFAULT_MIN_INDEPENDENT_SOURCES
): SourceCorroborationResult {
  const grouped = new Map<string, SourceReport[]>();
  for (const report of registry.reports) {
    grouped.set(report.normalizedText, [...(grouped.get(report.normalizedText) ?? []), report]);
  }

  const requiredClaims: SourceCorroborationClaim[] = [];
  const corroboratedClaims: SourceCorroborationClaim[] = [];

  for (const [normalizedText, reports] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const report of reports.sort((a, b) => a.claimId.localeCompare(b.claimId))) {
      if (report.confidence < 0.6) continue;
      const reportSource = findSource(registry, report.sourceId);
      if (reportSource.sourceType === "fixture" && !reportSource.tags.includes("sourcevet")) continue;
      const independentSourceIds = unique(
        reports
          .filter((candidate) => candidate.id !== report.id && reportsAreIndependent(registry, report, candidate))
          .map((candidate) => candidate.sourceId)
      ).sort();
      const claimResult: SourceCorroborationClaim = {
        claimId: report.claimId,
        sourceId: report.sourceId,
        text: report.text,
        normalizedText,
        independentSourceIds,
        reason:
          independentSourceIds.length + 1 >= minIndependentSources
            ? `${report.claimId} has independent corroboration from ${independentSourceIds.join(", ")}.`
            : `${report.claimId} requires at least ${minIndependentSources} independent sources.`
      };

      if (independentSourceIds.length + 1 >= minIndependentSources) corroboratedClaims.push(claimResult);
      else requiredClaims.push(claimResult);
    }
  }

  return {
    status: requiredClaims.length === 0 ? "pass" : "fail",
    minIndependentSources,
    requiredClaims,
    corroboratedClaims
  };
}

export function reviewKnowledgeUnits(units: KnowledgeUnit[], options: SourceVetReviewOptions = {}): SourceReview {
  if (units.length === 0) {
    throw new Error("SourceVet rejected review: at least one KnowledgeUnit is required.");
  }

  let registry = createRegistry();
  for (const unit of units) {
    registry = registerSourceFromKnowledgeUnit(registry, unit);
  }
  for (const unit of units) {
    for (const claim of unit.claims) {
      registry = addReportFromClaim(registry, unit.id, claim);
    }
  }

  const sourceAssessments = registry.sources.map((source) => assessSource(registry, source.id));
  const circularLineage = detectCircularLineage(registry);
  const independentCorroboration = detectIndependentCorroboration(
    registry,
    options.minIndependentSources ?? DEFAULT_MIN_INDEPENDENT_SOURCES
  );
  const flags = uniqueFlags(sourceAssessments.flatMap((assessment) => assessment.flags));
  const fabricationRisk = computeFabricationRisk(registry);
  const status =
    circularLineage.length > 0 || flags.some((flag) => flag.severity === "critical")
      ? "fail"
      : flags.some((flag) => flag.severity === "high")
        ? "review_required"
        : "pass";
  const reviewHash = hashPayload({
    sourceIds: registry.sources.map((source) => source.id).sort(),
    reportIds: registry.reports.map((report) => report.id).sort(),
    flags: flags.map((flag) => `${flag.code}:${flag.sourceId ?? ""}:${flag.claimId ?? ""}`).sort()
  });

  return {
    id: `sv_${reviewHash.slice(0, 12)}`,
    status,
    sourceCount: registry.sources.length,
    reportCount: registry.reports.length,
    claimCount: units.reduce((sum, unit) => sum + unit.claims.length, 0),
    fabricationRisk,
    flags,
    sourceAssessments,
    independentCorroboration,
    circularLineage,
    recommendations: buildRecommendations(flags, circularLineage.length > 0)
  };
}

function findSource(registry: SourceVetRegistry, sourceId: string): SourceRecord {
  const source = registry.sources.find((item) => item.id === sourceId);
  if (!source) {
    throw new Error(`SourceVet source not found: ${sourceId}.`);
  }
  return source;
}

function resolveSourceRef(registry: SourceVetRegistry, ref: string): string[] {
  const normalized = ref.replace(/^source:/, "").replace(/^ku:/, "");
  return registry.sources
    .filter(
      (source) =>
        source.id === ref ||
        source.id === normalized ||
        source.sourceUri === ref ||
        source.provenance.originalLocation === ref
    )
    .map((source) => source.id);
}

function buildLineageEdges(registry: SourceVetRegistry): SourceLineageEdge[] {
  const edges: SourceLineageEdge[] = [];
  const seen = new Set<string>();
  for (const report of registry.reports) {
    for (const citedSourceId of report.citedSourceIds) {
      const ref = report.evidenceRefs.find((item) => resolveSourceRef(registry, item).includes(citedSourceId)) ?? citedSourceId;
      const key = `${report.sourceId}->${citedSourceId}:${ref}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ fromSourceId: report.sourceId, toSourceId: citedSourceId, evidenceRef: ref });
      }
    }
  }
  return edges.sort((a, b) =>
    `${a.fromSourceId}:${a.toSourceId}:${a.evidenceRef}`.localeCompare(`${b.fromSourceId}:${b.toSourceId}:${b.evidenceRef}`)
  );
}

function reportsAreIndependent(registry: SourceVetRegistry, left: SourceReport, right: SourceReport): boolean {
  if (left.sourceId === right.sourceId) return false;
  if (left.citedSourceIds.includes(right.sourceId) || right.citedSourceIds.includes(left.sourceId)) return false;

  const leftSource = findSource(registry, left.sourceId);
  const rightSource = findSource(registry, right.sourceId);
  if (leftSource.provenance.contentHash === rightSource.provenance.contentHash) return false;
  if (leftSource.provenance.originalLocation && leftSource.provenance.originalLocation === rightSource.provenance.originalLocation) {
    return false;
  }

  return true;
}

function reliabilityRisk(reliability: string | undefined): number {
  if (!isValidReliability(reliability)) return 1;
  const sourceReliability = { A: 0.02, B: 0.1, C: 0.25, D: 0.45, E: 0.65, F: 0.85 }[reliability[0]] ?? 1;
  const informationCredibility = { "1": 0.02, "2": 0.1, "3": 0.25, "4": 0.45, "5": 0.65, "6": 0.85 }[
    reliability[1]
  ] ?? 1;
  return round((sourceReliability + informationCredibility) / 2);
}

function isValidReliability(reliability: string | undefined): reliability is string {
  return /^[A-F][1-6]$/.test(reliability ?? "");
}

function normalizeClaimText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function canonicalCycleKey(sourcePath: string[]): string {
  const cycle = sourcePath[0] === sourcePath[sourcePath.length - 1] ? sourcePath.slice(0, -1) : [...sourcePath];
  const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)].join("->"));
  return rotations.sort()[0] ?? "";
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function uniqueFlags(flags: SourceRiskFlag[]): SourceRiskFlag[] {
  const seen = new Set<string>();
  const uniqueItems: SourceRiskFlag[] = [];
  for (const flag of flags.sort(compareFlags)) {
    const key = `${flag.code}:${flag.sourceId ?? ""}:${flag.claimId ?? ""}:${flag.summary}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueItems.push(flag);
    }
  }
  return uniqueItems;
}

function compareFlags(left: SourceRiskFlag, right: SourceRiskFlag): number {
  return (
    severityRank(right.severity) - severityRank(left.severity) ||
    left.code.localeCompare(right.code) ||
    (left.sourceId ?? "").localeCompare(right.sourceId ?? "") ||
    (left.claimId ?? "").localeCompare(right.claimId ?? "")
  );
}

function severityRank(severity: SourceRiskFlag["severity"]): number {
  return { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[severity];
}

function buildRecommendations(flags: SourceRiskFlag[], hasCircularLineage: boolean): string[] {
  const recommendations: string[] = [];
  if (hasCircularLineage) {
    recommendations.push("Break circular lineage before using these claims in ACH or briefing outputs.");
  }
  if (flags.some((flag) => flag.code === "independent-corroboration-required")) {
    recommendations.push("Require independently captured corroboration before promoting single-source claims.");
  }
  if (flags.some((flag) => flag.code === "missing-reliability" || flag.code === "missing-provenance")) {
    recommendations.push("Backfill reliability and provenance metadata or reject the affected source.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Source review passed local deterministic checks.");
  }
  return recommendations;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
