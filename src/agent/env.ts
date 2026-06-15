import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type DotEnvLoadResult = {
  path: string;
  loaded: boolean;
  keys: string[];
};

export function loadDotEnvFile(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  filename = ".env"
): DotEnvLoadResult {
  const path = resolve(cwd, filename);
  if (!existsSync(path)) {
    return { path, loaded: false, keys: [] };
  }

  const parsed = parseDotEnv(readFileSync(path, "utf8"));
  const keys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
      keys.push(key);
    }
  }
  return { path, loaded: true, keys };
}

export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) continue;

    const key = withoutExport.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const rawValue = withoutExport.slice(separator + 1).trim();
    values[key] = parseDotEnvValue(rawValue);
  }
  return values;
}

function parseDotEnvValue(rawValue: string): string {
  if (!rawValue) return "";
  const quote = rawValue[0];
  if (quote === "\"" || quote === "'") {
    const end = findClosingQuote(rawValue, quote);
    const inner = end >= 0 ? rawValue.slice(1, end) : rawValue.slice(1);
    return quote === "\"" ? unescapeDoubleQuotedValue(inner) : inner;
  }
  return stripInlineComment(rawValue).trim();
}

function findClosingQuote(value: string, quote: string): number {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === quote && value[index - 1] !== "\\") {
      return index;
    }
  }
  return -1;
}

function unescapeDoubleQuotedValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function stripInlineComment(value: string): string {
  const match = value.match(/\s+#/);
  if (!match || match.index === undefined) return value;
  return value.slice(0, match.index);
}
