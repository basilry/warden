import { createHash } from "node:crypto";

let counter = 0;

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  counter += 1;
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${counter.toString(36).padStart(4, "0")}`;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue(record[key]);
        return acc;
      }, {});
  }
  return value;
}
