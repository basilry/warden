import type { RuntimeEvent, RuntimeRun } from "./types.ts";
import { cloneRuntimeValue, type RuntimeRepository } from "./storage.ts";

export function createMemoryRuntimeRepository(initialRuns: RuntimeRun[] = []): RuntimeRepository {
  const runs = new Map<string, RuntimeRun>();
  const events = new Map<string, RuntimeEvent[]>();

  for (const run of initialRuns) {
    runs.set(run.id, cloneRuntimeValue(run));
    events.set(run.id, cloneRuntimeValue(run.events));
  }

  return {
    kind: "memory",
    saveRun(run) {
      runs.set(run.id, cloneRuntimeValue(run));
    },
    loadRun(runId) {
      const run = runs.get(runId);
      return run ? hydrateRunEvents(run, events.get(runId) ?? []) : undefined;
    },
    listRuns() {
      return [...runs.values()].map((run) => hydrateRunEvents(run, events.get(run.id) ?? []));
    },
    appendEvent(event) {
      const current = events.get(event.runId) ?? [];
      current.push(cloneRuntimeValue(event));
      events.set(event.runId, current);
    },
    listEvents(runId) {
      return cloneRuntimeValue(events.get(runId) ?? []);
    }
  };
}

function hydrateRunEvents(run: RuntimeRun, persistedEvents: RuntimeEvent[]): RuntimeRun {
  const cloned = cloneRuntimeValue(run);
  cloned.events = persistedEvents.length > 0 ? cloneRuntimeValue(persistedEvents) : cloned.events;
  return cloned;
}
