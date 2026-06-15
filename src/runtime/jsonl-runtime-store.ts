import { mkdirSync } from "node:fs";
import { appendJsonl, dedupeByLatest, readJsonl, safeJoin } from "../agent/storage/files.ts";
import type { RuntimeEvent, RuntimeRun } from "./types.ts";
import { cloneRuntimeValue, type RuntimeRepository, type RuntimeRunSnapshot } from "./storage.ts";

export function createJsonlRuntimeRepository(rootDir: string): RuntimeRepository {
  const runtimeRoot = safeJoin(rootDir, "runtime");
  mkdirSync(safeJoin(runtimeRoot, "events"), { recursive: true });

  return {
    kind: "jsonl",
    saveRun(run) {
      appendJsonl(runsPath(runtimeRoot), cloneRuntimeValue(run));
    },
    loadRun(runId) {
      const run = latestRunSnapshots(runtimeRoot).get(runId);
      return run ? hydrateRunEvents(runtimeRoot, run) : undefined;
    },
    listRuns() {
      return [...latestRunSnapshots(runtimeRoot).values()].map((run) => hydrateRunEvents(runtimeRoot, run));
    },
    appendEvent(event) {
      appendJsonl(eventPath(runtimeRoot, event.runId), cloneRuntimeValue(event));
    },
    listEvents(runId) {
      return readJsonl<RuntimeEvent>(eventPath(runtimeRoot, runId));
    }
  };
}

function latestRunSnapshots(runtimeRoot: string): Map<string, RuntimeRunSnapshot> {
  const snapshots = dedupeByLatest(readJsonl<RuntimeRunSnapshot>(runsPath(runtimeRoot)), (run) => run.id);
  return new Map(snapshots.map((run) => [run.id, run]));
}

function hydrateRunEvents(runtimeRoot: string, run: RuntimeRunSnapshot): RuntimeRun {
  const events = readJsonl<RuntimeEvent>(eventPath(runtimeRoot, run.id));
  const cloned = cloneRuntimeValue(run);
  cloned.events = events.length > 0 ? events : cloned.events;
  return cloned;
}

function runsPath(runtimeRoot: string): string {
  return safeJoin(runtimeRoot, "runs.jsonl");
}

function eventPath(runtimeRoot: string, runId: string): string {
  return safeJoin(runtimeRoot, "events", `${encodeURIComponent(runId)}.jsonl`);
}
