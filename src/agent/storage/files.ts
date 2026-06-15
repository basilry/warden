import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";

export function ensureStorageDirs(rootDir: string): void {
  for (const segment of ["", "traces", "artifacts", "bundles"]) {
    mkdirSync(safeJoin(rootDir, segment), { recursive: true });
  }
}

export function safeJoin(rootDir: string, ...parts: string[]): string {
  const root = resolve(rootDir);
  const target = resolve(root, ...parts);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Path escapes storage root: ${target}`);
  }
  return target;
}

export function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${(error as Error).message}`);
    }
  });
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

export function sha256Bytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function fileSize(path: string): number {
  return statSync(path).size;
}

export function dedupeByLatest<T>(items: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(getKey(item), item);
  }
  return [...map.values()];
}
