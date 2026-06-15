import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { buildDocumentProvenance, hashDocument, type DocumentMetadata } from "./document-hash.ts";
import { parseHtmlDocument } from "./parsers/html.ts";
import { parsePdfDocument } from "./parsers/pdf.ts";
import { parseTextDocument, type ParsedDocument } from "./parsers/text.ts";
import { hashPayload, newId, nowIso } from "../ids.ts";
import type { Claim, KnowledgeUnit } from "../types.ts";

export type IngestOptions = {
  sourceUri: string;
  sourceType?: KnowledgeUnit["sourceType"];
  tags?: string[];
  reliability?: string;
};

export type DocumentIngestResult = {
  units: KnowledgeUnit[];
  warnings: string[];
  parserVersion: string;
  documentHash: string;
};

export function ingestManualText(text: string, options: IngestOptions): KnowledgeUnit[] {
  const claims = extractClaimsFromText(text);
  return claims.map((claim) => createUnitFromClaim(claim, text, options));
}

export function ingestPlainTextFile(path: string, options: Omit<IngestOptions, "sourceUri"> = {}): KnowledgeUnit[] {
  const text = readFileSync(path, "utf8");
  return ingestManualText(text, {
    sourceUri: `file://${path}`,
    sourceType: "fixture",
    ...options
  });
}

export function ingestHtmlSnippet(html: string, options: IngestOptions): KnowledgeUnit[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ingestManualText(text, {
    ...options,
    sourceType: options.sourceType ?? "html"
  });
}

export function ingestDocument(path: string, options: Omit<IngestOptions, "sourceUri"> = {}): DocumentIngestResult {
  const buffer = readFileSync(path);
  const sourceType = options.sourceType ?? inferSourceType(path);
  const metadata: DocumentMetadata = {
    path,
    sourceUri: `file://${path}`,
    sourceType
  };
  const parsed = parseDocument(buffer, metadata);
  const documentHash = hashDocument(buffer);
  const claims = extractClaimsFromText(parsed.text);
  const units = claims.map((claim) => createUnitFromParsedClaim(claim, parsed, documentHash, options));
  return {
    units,
    warnings: parsed.warnings,
    parserVersion: parsed.parserVersion,
    documentHash
  };
}

export function extractClaimsFromText(text: string): Claim[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => ({
      id: newId("claim"),
      text: line,
      confidence: extractReliabilityHint(line) ? 0.8 : 0.45,
      evidenceRefs: [newId("raw")]
    }));
}

function createUnitFromClaim(claim: Claim, rawText: string, options: IngestOptions): KnowledgeUnit {
  const reliability = options.reliability ?? extractReliabilityHint(claim.text);
  return {
    id: newId("ku"),
    sourceUri: options.sourceUri,
    sourceType: options.sourceType ?? "manual",
    extractedAt: nowIso(),
    claims: [{ ...claim, text: stripReliabilityHint(claim.text) }],
    provenance: {
      capturedBy: "agent",
      originalLocation: options.sourceUri,
      contentHash: hashPayload({ rawText, claim: claim.text }),
      parserVersion: "p1-text-v1"
    },
    reliability,
    tags: options.tags ?? []
  };
}

function createUnitFromParsedClaim(
  claim: Claim,
  parsed: ParsedDocument,
  documentHash: string,
  options: Omit<IngestOptions, "sourceUri">
): KnowledgeUnit {
  const reliability = options.reliability ?? extractReliabilityHint(claim.text);
  return {
    id: newId("ku"),
    sourceUri: parsed.metadata.sourceUri,
    sourceType: parsed.metadata.sourceType,
    extractedAt: nowIso(),
    claims: [{ ...claim, text: stripReliabilityHint(claim.text) }],
    provenance: buildDocumentProvenance(parsed.metadata.path, documentHash, parsed.parserVersion),
    reliability,
    tags: options.tags ?? []
  };
}

function parseDocument(buffer: Uint8Array, metadata: DocumentMetadata): ParsedDocument {
  if (metadata.sourceType === "html") return parseHtmlDocument(buffer, metadata);
  if (metadata.sourceType === "pdf") return parsePdfDocument(buffer, metadata);
  return parseTextDocument(buffer, metadata);
}

function inferSourceType(path: string): KnowledgeUnit["sourceType"] {
  const ext = extname(path).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".pdf") return "pdf";
  return "manual";
}

function extractReliabilityHint(text: string): string | undefined {
  return text.match(/\b[A-F][1-6]\b/)?.[0];
}

function stripReliabilityHint(text: string): string {
  return text.replace(/\s*\[[A-F][1-6]\]\s*/g, " ").replace(/\s+/g, " ").trim();
}
