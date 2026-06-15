import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hashPayload, nowIso } from "./ids.ts";
import type { TraceEvent, TraceRecorder, TraceSummary } from "./types.ts";

export function createTraceRecorder(runId: string): TraceRecorder {
  const events: TraceEvent[] = [];

  return {
    runId,
    record(event) {
      const traceEvent: TraceEvent = {
        ts: nowIso(),
        runId,
        taskId: event.taskId,
        phase: event.phase,
        actor: event.actor,
        summary: event.summary,
        ref: event.ref,
        payloadHash: event.payload === undefined ? undefined : hashPayload(event.payload)
      };
      events.push(traceEvent);
      return traceEvent;
    },
    getEvents() {
      return [...events];
    },
    summarize() {
      return summarizeTrace(events, runId);
    }
  };
}

export function summarizeTrace(events: TraceEvent[], runId = events[0]?.runId ?? "unknown"): TraceSummary {
  const phases: Record<string, number> = {};
  const policyDecisions: Record<string, number> = {};
  const toolCalls: string[] = [];
  const failures: string[] = [];

  for (const event of events) {
    phases[event.phase] = (phases[event.phase] ?? 0) + 1;

    if (event.phase === "policy_decision") {
      const key = parsePolicyDecision(event.summary);
      policyDecisions[key] = (policyDecisions[key] ?? 0) + 1;
    }

    if (event.phase === "tool_call" && event.ref) {
      toolCalls.push(event.ref);
    }

    if (event.phase === "failure") {
      failures.push(event.summary);
    }
  }

  return {
    runId,
    eventCount: events.length,
    phases,
    policyDecisions,
    toolCalls,
    failures
  };
}

export function writeTraceJsonl(path: string, events: TraceEvent[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  writeFileSync(path, body.length > 0 ? `${body}\n` : "", "utf8");
}

export function renderTraceTimeline(events: TraceEvent[]): string {
  return events
    .map((event) => {
      const ref = event.ref ? ` [${event.ref}]` : "";
      return `- ${event.phase}${ref}: ${event.summary}`;
    })
    .join("\n");
}

function parsePolicyDecision(summary: string): string {
  if (summary.includes("require_approval")) return "require_approval";
  if (summary.includes("deny")) return "deny";
  if (summary.includes("allow")) return "allow";
  return "unknown";
}
