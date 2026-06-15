import type { WardenConfig } from "../config.ts";
import { createJsonlStorageProvider } from "./jsonl-store.ts";
import { createMemoryStorageProvider } from "./memory-store.ts";
import type { StorageProvider, StorageProviderKind } from "./types.ts";

export function createStorageProvider(config: WardenConfig["storage"] | StorageProviderKind): StorageProvider {
  const storage = typeof config === "string" ? { kind: config, rootDir: "data" } : config;

  if (storage.kind === "memory") {
    return createMemoryStorageProvider();
  }
  if (storage.kind === "jsonl") {
    return createJsonlStorageProvider(storage.rootDir);
  }
  throw new Error("SQLite storage provider is planned for a later P4 hardening pass.");
}
