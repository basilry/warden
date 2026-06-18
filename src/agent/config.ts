import { resolve } from "node:path";
import { loadDotEnvFile } from "./env.ts";
import type { OsintConnectorConfig } from "../connectors/osint/types.ts";
import type { StorageProviderKind } from "./storage/types.ts";

export type ModelProviderKind = "mock" | "openai-compatible" | "codex" | "local";

export type WardenConfig = {
  model: {
    provider: ModelProviderKind;
    openaiCompatible: {
      endpoint: string;
      model: string;
      apiKeyEnv: string;
      dryRun: boolean;
      liveOptIn: boolean;
    };
    codex: {
      command: string;
      model?: string;
      dryRun: boolean;
      timeoutMs: number;
      sandbox: "read-only" | "workspace-write" | "danger-full-access";
      cwd: string;
    };
    local: {
      endpoint?: string;
      model: string;
      dryRun: boolean;
    };
  };
  storage: {
    kind: StorageProviderKind;
    rootDir: string;
  };
  osint: OsintConnectorConfig;
};

export function loadWardenConfig(
  env?: Record<string, string | undefined>,
  cwd = process.cwd()
): WardenConfig {
  if (!env) {
    loadDotEnvFile(cwd);
  }
  const sourceEnv = env ?? process.env;
  return {
    model: {
      provider: parseModelProviderKind(sourceEnv.WARDEN_MODEL_PROVIDER ?? "mock"),
      openaiCompatible: {
        endpoint: sourceEnv.WARDEN_OPENAI_ENDPOINT ?? "https://api.openai.com/v1/responses",
        model: sourceEnv.WARDEN_OPENAI_MODEL ?? "gpt-5.4",
        apiKeyEnv: sourceEnv.WARDEN_OPENAI_API_KEY_ENV ?? "OPENAI_API_KEY",
        dryRun: parseBoolean(sourceEnv.WARDEN_OPENAI_DRY_RUN, true),
        liveOptIn: parseBoolean(sourceEnv.WARDEN_OPENAI_LIVE_OPT_IN, false)
      },
      codex: {
        command: sourceEnv.WARDEN_CODEX_COMMAND ?? "codex",
        model: sourceEnv.WARDEN_CODEX_MODEL || undefined,
        dryRun: parseBoolean(sourceEnv.WARDEN_CODEX_DRY_RUN, true),
        timeoutMs: parsePositiveInteger(sourceEnv.WARDEN_CODEX_TIMEOUT_MS, 120000),
        sandbox: parseCodexSandbox(sourceEnv.WARDEN_CODEX_SANDBOX ?? "read-only"),
        cwd: resolve(cwd, sourceEnv.WARDEN_CODEX_CWD ?? ".")
      },
      local: {
        endpoint: sourceEnv.WARDEN_LOCAL_MODEL_ENDPOINT || undefined,
        model: sourceEnv.WARDEN_LOCAL_MODEL ?? "local-model-candidate",
        dryRun: parseBoolean(sourceEnv.WARDEN_LOCAL_MODEL_DRY_RUN, true)
      }
    },
    storage: {
      kind: parseStorageProviderKind(sourceEnv.WARDEN_STORAGE ?? "memory"),
      rootDir: resolve(cwd, sourceEnv.WARDEN_STORAGE_DIR ?? "data")
    },
    osint: {
      liveOptIn: parseBoolean(sourceEnv.WARDEN_OSINT_LIVE_OPT_IN, false),
      allowlistPath: resolve(cwd, sourceEnv.WARDEN_OSINT_ALLOWLIST ?? "fixtures/osint/allowlist.json"),
      searchEnabled: parseBoolean(sourceEnv.WARDEN_OSINT_SEARCH_ENABLED, true),
      searchSourcesPath: resolve(cwd, sourceEnv.WARDEN_OSINT_SEARCH_SOURCES ?? "fixtures/osint/search-sources.json"),
      timeoutMs: parsePositiveInteger(sourceEnv.WARDEN_OSINT_TIMEOUT_MS, 8000),
      maxResults: parseBoundedPositiveInteger(sourceEnv.WARDEN_OSINT_MAX_RESULTS, 8, 1, 25),
      maxQueries: parseBoundedPositiveInteger(sourceEnv.WARDEN_OSINT_MAX_QUERIES, 2, 1, 6),
      maxSourcesPerQuery: parseBoundedPositiveInteger(sourceEnv.WARDEN_OSINT_MAX_SOURCES_PER_QUERY, 4, 1, 12),
      userAgent: sourceEnv.WARDEN_OSINT_USER_AGENT ?? "WARDEN-Agent/0.1 live-osint-guard"
    }
  };
}

export function parseStorageProviderKind(value: string): StorageProviderKind {
  if (value === "memory" || value === "jsonl" || value === "sqlite") {
    return value;
  }
  throw new Error(`Unsupported WARDEN_STORAGE value: ${value}`);
}

export function parseModelProviderKind(value: string): ModelProviderKind {
  if (value === "mock" || value === "openai-compatible" || value === "codex" || value === "local") {
    return value;
  }
  throw new Error(`Unsupported WARDEN_MODEL_PROVIDER value: ${value}`);
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`Expected boolean environment value, got: ${value}`);
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer environment value, got: ${value}`);
  }
  return parsed;
}

function parseBoundedPositiveInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const parsed = parsePositiveInteger(value, defaultValue);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`Expected integer from ${minimum} to ${maximum}, got: ${parsed}`);
  }
  return parsed;
}

function parseCodexSandbox(value: string): WardenConfig["model"]["codex"]["sandbox"] {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  throw new Error(`Unsupported WARDEN_CODEX_SANDBOX value: ${value}`);
}
