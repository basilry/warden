import type { WardenConfig } from "../agent/config.ts";
import type { RuntimeState } from "./types.ts";
import { createJsonlRuntimeRepository } from "./jsonl-runtime-store.ts";
import { createMemoryRuntimeRepository } from "./memory-runtime-store.ts";
import {
  attachRuntimeRepository,
  getRuntimeRepository,
  type PersistentRuntimeState,
  type RuntimeRepository
} from "./storage.ts";

export type RuntimeRehydrateResult = {
  runs: number;
  events: number;
};

export function createRuntimeRepository(config: WardenConfig["storage"]): RuntimeRepository {
  if (config.kind === "memory") {
    return createMemoryRuntimeRepository();
  }
  if (config.kind === "jsonl") {
    return createJsonlRuntimeRepository(config.rootDir);
  }
  throw new Error("Runtime persistence does not support sqlite yet. Use WARDEN_STORAGE=memory or WARDEN_STORAGE=jsonl.");
}

export function createPersistentRuntimeState(repository: RuntimeRepository): PersistentRuntimeState {
  const state = attachRuntimeRepository({ runs: new Map() }, repository);
  rehydrateRuntimeState(state, repository);
  return state;
}

export function rehydrateRuntimeState(
  state: RuntimeState,
  repository = getRuntimeRepository(state)
): RuntimeRehydrateResult {
  if (!repository) {
    return { runs: state.runs.size, events: [...state.runs.values()].reduce((total, run) => total + run.events.length, 0) };
  }

  const runs = repository.listRuns();
  state.runs.clear();
  let eventCount = 0;
  for (const run of runs) {
    const events = repository.listEvents(run.id);
    run.events = events.length > 0 ? events : run.events;
    eventCount += run.events.length;
    state.runs.set(run.id, run);
  }
  return { runs: runs.length, events: eventCount };
}
