import type { DocumentMetadata } from "../document-hash.ts";

export type ParsedDocument = {
  text: string;
  parserVersion: string;
  warnings: string[];
  metadata: DocumentMetadata;
};

export function parseTextDocument(buffer: Uint8Array, metadata: DocumentMetadata): ParsedDocument {
  const text = new TextDecoder("utf8", { fatal: false }).decode(buffer).trim();
  return {
    text,
    parserVersion: "p5-text-v1",
    warnings: text.length === 0 ? ["text document is empty"] : [],
    metadata
  };
}
