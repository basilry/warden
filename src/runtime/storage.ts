import type { RuntimeEvent, RuntimeRun, RuntimeState } from "./types.ts";

export type RuntimeRepositoryKind = "memory" | "jsonl";

export type RuntimeRepository = {
  kind: RuntimeRepositoryKind;
  saveRun(run: RuntimeRun): void;
  loadRun(runId: string): RuntimeRun | undefined;
  listRuns(): RuntimeRun[];
  appendEvent(event: RuntimeEvent): void;
  listEvents(runId: string): RuntimeEvent[];
};

export type PersistentRuntimeState = RuntimeState & {
  repository: RuntimeRepository;
};

export type RuntimeRunSnapshot = RuntimeRun;

export function attachRuntimeRepository(state: RuntimeState, repository: RuntimeRepository): PersistentRuntimeState {
  return Object.assign(state, { repository });
}

export function getRuntimeRepository(state: RuntimeState): RuntimeRepository | undefined {
  return (state as Partial<PersistentRuntimeState>).repository;
}

export function saveRuntimeRun(repository: RuntimeRepository | undefined, run: RuntimeRun): void {
  repository?.saveRun(run);
}

export function appendRuntimeEvent(repository: RuntimeRepository | undefined, event: RuntimeEvent): void {
  repository?.appendEvent(event);
}

export function cloneRuntimeValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
