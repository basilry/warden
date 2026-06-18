import { readFileSync } from "node:fs";
import type { KnowledgeUnit } from "../../agent/types.ts";
import type { LocalCorpusClaim, LocalCorpusEntry, LocalRagCorpus, LocalRagCorpusSummary } from "./types.ts";

const DEFAULT_CORPUS_URL = new URL("../../../fixtures/rag/domain-corpus.json", import.meta.url);

export function getDefaultRagCorpusPath(): string {
  return DEFAULT_CORPUS_URL.pathname;
}

export function loadLocalRagCorpus(path = getDefaultRagCorpusPath()): LocalRagCorpus {
  const raw = readFileSync(path, "utf8");
  const parsed = parseLocalRagCorpus(JSON.parse(raw) as unknown);
  const warnings = validateLocalRagCorpus(parsed);
  if (warnings.length > 0) {
    throw new Error(`Invalid local RAG corpus: ${warnings.join("; ")}`);
  }
  return parsed;
}

export function validateLocalRagCorpus(corpus: LocalRagCorpus): string[] {
  const warnings: string[] = [];
  if (!corpus.corpusId) warnings.push("corpusId is required");
  if (!corpus.version) warnings.push("version is required");
  if (!corpus.title) warnings.push("title is required");
  if (!Array.isArray(corpus.entries) || corpus.entries.length === 0) warnings.push("entries is empty");

  const entryIds = new Set<string>();
  const claimIds = new Set<string>();
  for (const entry of corpus.entries) {
    if (!entry.id) warnings.push("entry.id is required");
    if (entryIds.has(entry.id)) warnings.push(`duplicate entry id: ${entry.id}`);
    entryIds.add(entry.id);
    if (!entry.title) warnings.push(`entry ${entry.id || "(unknown)"} title is required`);
    if (!Array.isArray(entry.tags) || entry.tags.length === 0) warnings.push(`entry ${entry.id} tags is empty`);
    if (!Array.isArray(entry.claims) || entry.claims.length === 0) {
      warnings.push(`entry ${entry.id} claims is empty`);
      continue;
    }
    for (const claim of entry.claims) {
      if (!claim.id) warnings.push(`entry ${entry.id} has a claim without id`);
      if (claimIds.has(claim.id)) warnings.push(`duplicate claim id: ${claim.id}`);
      claimIds.add(claim.id);
      if (!claim.text) warnings.push(`claim ${claim.id || "(unknown)"} text is required`);
      if (claim.confidence !== undefined && (claim.confidence < 0 || claim.confidence > 1)) {
        warnings.push(`claim ${claim.id} confidence must be from 0 to 1`);
      }
    }
  }
  return warnings;
}

export function buildKnowledgeUnitsFromCorpus(corpus = loadLocalRagCorpus()): KnowledgeUnit[] {
  return corpus.entries.map((entry): KnowledgeUnit => {
    const sourceUri = entry.uri ?? `fixture://${corpus.corpusId}/${entry.id}`;
    return {
      id: `ku_${entry.id}`,
      sourceUri,
      sourceType: entry.sourceType ?? "fixture",
      extractedAt: entry.extractedAt ?? normalizeExtractedAt(corpus.version),
      claims: entry.claims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        confidence: claim.confidence ?? reliabilityToConfidence(entry.reliability),
        evidenceRefs: claim.evidenceRefs ?? [`corpus:${corpus.corpusId}`, `entry:${entry.id}`]
      })),
      provenance: {
        capturedBy: "agent",
        originalLocation: sourceUri,
        contentHash: stableCorpusHash(corpus.corpusId, entry),
        parserVersion: `p21-rag-corpus-${corpus.version}`
      },
      reliability: entry.reliability,
      tags: uniqueNonEmpty([...entry.tags, `corpus:${corpus.corpusId}`, `entry:${entry.id}`])
    };
  });
}

export function summarizeKnowledgeUnits(
  corpus: LocalRagCorpus,
  units = buildKnowledgeUnitsFromCorpus(corpus),
  tags: string[] = []
): LocalRagCorpusSummary {
  const filtered = filterUnitsByTags(units, tags);
  const reliability: Record<string, number> = {};
  const allTags = new Set<string>();
  let claimCount = 0;

  for (const unit of filtered) {
    claimCount += unit.claims.length;
    reliability[unit.reliability ?? "unrated"] = (reliability[unit.reliability ?? "unrated"] ?? 0) + 1;
    for (const tag of unit.tags) allTags.add(tag);
  }

  return {
    corpusId: corpus.corpusId,
    title: corpus.title,
    version: corpus.version,
    description: corpus.description,
    unitCount: filtered.length,
    claimCount,
    tags: [...allTags].sort(),
    reliability: sortRecord(reliability)
  };
}

function filterUnitsByTags(units: KnowledgeUnit[], tags: string[]): KnowledgeUnit[] {
  if (tags.length === 0) return units;
  const required = new Set(tags);
  return units.filter((unit) => [...required].every((tag) => unit.tags.includes(tag)));
}

function parseLocalRagCorpus(value: unknown): LocalRagCorpus {
  if (!isRecord(value)) throw new Error("corpus must be an object");
  return {
    corpusId: readString(value.corpusId),
    version: readString(value.version),
    title: readString(value.title),
    description: readOptionalString(value.description),
    entries: readArray(value.entries).map(parseLocalCorpusEntry)
  };
}

function parseLocalCorpusEntry(value: unknown): LocalCorpusEntry {
  if (!isRecord(value)) {
    return { id: "", title: "", tags: [], claims: [] };
  }
  return {
    id: readString(value.id),
    title: readString(value.title),
    uri: readOptionalString(value.uri),
    sourceType: parseSourceType(value.sourceType),
    extractedAt: readOptionalString(value.extractedAt),
    reliability: readOptionalString(value.reliability),
    tags: readStringArray(value.tags),
    claims: readArray(value.claims).map(parseLocalCorpusClaim)
  };
}

function parseLocalCorpusClaim(value: unknown): LocalCorpusClaim {
  if (!isRecord(value)) {
    return { id: "", text: "" };
  }
  return {
    id: readString(value.id),
    text: readString(value.text),
    confidence: readOptionalNumber(value.confidence),
    evidenceRefs: readOptionalStringArray(value.evidenceRefs)
  };
}

function parseSourceType(value: unknown): KnowledgeUnit["sourceType"] | undefined {
  return value === "fixture" ||
    value === "pdf" ||
    value === "html" ||
    value === "api" ||
    value === "manual" ||
    value === "report"
    ? value
    : undefined;
}

function normalizeExtractedAt(version: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(version)) return `${version}T00:00:00.000Z`;
  return "1970-01-01T00:00:00.000Z";
}

function reliabilityToConfidence(reliability: string | undefined): number {
  if (!reliability) return 0.55;
  const letter = reliability[0] ?? "C";
  const number = Number(reliability[1] ?? "3");
  const letterScore = letter === "A" ? 0.88 : letter === "B" ? 0.74 : letter === "C" ? 0.62 : 0.5;
  const numberPenalty = Number.isFinite(number) ? Math.max(0, number - 1) * 0.04 : 0.08;
  return Number(Math.max(0.35, letterScore - numberPenalty).toFixed(2));
}

function stableCorpusHash(corpusId: string, entry: LocalCorpusEntry): string {
  const input = `${corpusId}:${entry.id}:${entry.claims.map((claim) => `${claim.id}:${claim.text}`).join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `p21_${hash.toString(16).padStart(8, "0")}`;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return sorted;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | undefined {
  const parsed = readString(value);
  return parsed || undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return readStringArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
