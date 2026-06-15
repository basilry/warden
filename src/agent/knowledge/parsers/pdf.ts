import type { DocumentMetadata } from "../document-hash.ts";
import type { ParsedDocument } from "./text.ts";

export function parsePdfDocument(buffer: Uint8Array, metadata: DocumentMetadata): ParsedDocument {
  const raw = new TextDecoder("latin1", { fatal: false }).decode(buffer);
  const text = raw
    .replace(/[^\x20-\x7E\n\r\t]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !token.startsWith("%PDF") && !token.includes("obj"))
    .join(" ")
    .trim();
  const warnings = [
    "pdf parser uses dependency-free text extraction; verify output before operational use",
    ...(text.length === 0 ? ["pdf parser produced no text"] : [])
  ];
  return {
    text,
    parserVersion: "p5-pdf-lite-v1",
    warnings,
    metadata
  };
}
