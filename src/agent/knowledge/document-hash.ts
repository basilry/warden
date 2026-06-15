import { createHash } from "node:crypto";
import type { KnowledgeUnit, Provenance } from "../types.ts";

export type DocumentMetadata = {
  path: string;
  sourceUri: string;
  sourceType: KnowledgeUnit["sourceType"];
};

export function hashDocument(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function buildDocumentProvenance(
  path: string,
  hash: string,
  parserVersion: string
): Provenance {
  return {
    capturedBy: "agent",
    originalLocation: `file://${path}`,
    contentHash: hash,
    parserVersion
  };
}
