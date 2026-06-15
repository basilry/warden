import { resolve } from "node:path";
import { loadDotEnvFile } from "./env.ts";
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

function parseCodexSandbox(value: string): WardenConfig["model"]["codex"]["sandbox"] {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  throw new Error(`Unsupported WARDEN_CODEX_SANDBOX value: ${value}`);
}
