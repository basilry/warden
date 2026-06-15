import type { DocumentMetadata } from "../document-hash.ts";
import type { ParsedDocument } from "./text.ts";

export function parseHtmlDocument(buffer: Uint8Array, metadata: DocumentMetadata): ParsedDocument {
  const html = new TextDecoder("utf8", { fatal: false }).decode(buffer);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return {
    text,
    parserVersion: "p5-html-v1",
    warnings: text.length === 0 ? ["html parser produced no text"] : [],
    metadata
  };
}
