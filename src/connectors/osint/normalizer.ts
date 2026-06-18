import { hashPayload } from "../../agent/ids.ts";
import { redactPayload } from "../../agent/security/redaction.ts";
import type { Claim, KnowledgeUnit } from "../../agent/types.ts";

export type OsintNormalizerProvenance = {
  sourceUri: string;
  sourceId?: string;
  approvalId: string;
  runId: string;
  capturedAt: string;
  tags?: string[];
};

export class MalformedOsintPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedOsintPayloadError";
  }
}

export function normalizeOsintResponseToKnowledgeUnits(
  payload: unknown,
  provenance: OsintNormalizerProvenance,
  options: { maxResults?: number } = {}
): KnowledgeUnit[] {
  const documents = extractDocuments(payload);
  const maxResults = normalizeMaxResults(options.maxResults, documents.length);
  const units = documents.slice(0, maxResults).map((document, index) => buildKnowledgeUnit(document, provenance, index));
  if (units.length === 0) {
    throw new MalformedOsintPayloadError("OSINT response did not contain any normalizable documents.");
  }
  return units;
}

export function redactOsintPayload(payload: unknown): unknown {
  return redactPayload(payload, { maxStringLength: 1000 });
}

function extractDocuments(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) {
    throw new MalformedOsintPayloadError("OSINT response payload must be an object.");
  }
  const documents = Array.isArray(payload.documents)
    ? payload.documents
    : Array.isArray(payload.items)
      ? payload.items
      : undefined;
  if (!documents) {
    throw new MalformedOsintPayloadError("OSINT response must include documents[] or items[].");
  }
  return documents.map((document, index) => {
    if (!isRecord(document)) {
      throw new MalformedOsintPayloadError(`OSINT document ${index} must be an object.`);
    }
    return document;
  });
}

function buildKnowledgeUnit(
  document: Record<string, unknown>,
  provenance: OsintNormalizerProvenance,
  index: number
): KnowledgeUnit {
  const sourceUri = parseOptionalString(document.url) ?? provenance.sourceUri;
  const title = parseOptionalString(document.title);
  const summary = parseOptionalString(document.summary);
  const claims = buildClaims(document, sourceUri, title, summary);
  if (claims.length === 0) {
    throw new MalformedOsintPayloadError(`OSINT document ${index} did not include claims or summary.`);
  }

  const contentHash = hashPayload({
    sourceUri,
    title,
    summary,
    claims,
    approvalId: provenance.approvalId,
    runId: provenance.runId
  });
  const sourceId = provenance.sourceId ? `source:${provenance.sourceId}` : undefined;
  return {
    id: `ku_live_osint_${contentHash.slice(0, 12)}`,
    sourceUri,
    sourceType: "api",
    extractedAt: parseOptionalString(document.publishedAt) ?? provenance.capturedAt,
    claims,
    provenance: {
      capturedBy: "connector",
      originalLocation: `${provenance.sourceUri}#document-${index + 1}`,
      contentHash,
      parserVersion: "warden-live-osint-normalizer/v1"
    },
    reliability: parseOptionalString(document.reliability) ?? "C3",
    tags: uniqueNonEmpty([
      "live-osint",
      "sourcevet-required",
      "external-osint",
      `approval:${provenance.approvalId}`,
      sourceId,
      ...parseStringArray(document.tags),
      ...(provenance.tags ?? [])
    ]),
    metadata: {
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
      ...(parseOptionalString(document.publishedAt) ? { publishedAt: parseOptionalString(document.publishedAt)! } : {}),
      ...(parseOptionalString(document.publisher) ? { publisher: parseOptionalString(document.publisher)! } : {}),
      ...(sourceUri ? { canonicalUrl: sourceUri } : {})
    }
  };
}

function buildClaims(
  document: Record<string, unknown>,
  sourceUri: string,
  title: string | undefined,
  summary: string | undefined
): Claim[] {
  const rawClaims = Array.isArray(document.claims) ? document.claims : undefined;
  if (rawClaims && rawClaims.length > 0) {
    return rawClaims.map((claim, index) => normalizeClaim(claim, index, sourceUri));
  }
  if (summary) {
    return [
      {
        id: `claim_${hashPayload({ sourceUri, title, summary }).slice(0, 12)}_1`,
        text: summary,
        confidence: 0.55,
        evidenceRefs: [`${sourceUri}#summary`]
      }
    ];
  }
  return [];
}

function normalizeClaim(value: unknown, index: number, sourceUri: string): Claim {
  if (typeof value === "string") {
    return makeClaim(value, index, 0.55, sourceUri);
  }
  if (!isRecord(value)) {
    throw new MalformedOsintPayloadError(`OSINT claim ${index} must be a string or object.`);
  }
  const text = parseOptionalString(value.text);
  if (!text) {
    throw new MalformedOsintPayloadError(`OSINT claim ${index} must include text.`);
  }
  const confidence = typeof value.confidence === "number" && Number.isFinite(value.confidence) ? value.confidence : 0.55;
  return makeClaim(text, index, Math.max(0, Math.min(confidence, 1)), sourceUri);
}

function makeClaim(text: string, index: number, confidence: number, sourceUri: string): Claim {
  return {
    id: `claim_live_osint_${hashPayload({ text, sourceUri, index }).slice(0, 12)}`,
    text,
    confidence,
    evidenceRefs: [`${sourceUri}#claim-${index + 1}`]
  };
}

function normalizeMaxResults(value: number | undefined, fallback: number): number {
  if (value === undefined) return Math.max(1, fallback);
  if (!Number.isInteger(value) || value < 1 || value > 25) {
    throw new MalformedOsintPayloadError("OSINT maxResults must be an integer from 1 to 25.");
  }
  return value;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim()).map((item) => item.trim());
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
