import { hashPayload } from "../ids.ts";
import type { TraceEvent } from "../types.ts";

export type AuditHashEvent = TraceEvent & {
  prevHash: string;
  eventHash: string;
};

export type AuditIntegrityReport = {
  status: "pass" | "fail";
  checked: number;
  failures: string[];
};

export function appendAuditHash(prevHash: string, event: TraceEvent): AuditHashEvent {
  const eventHash = hashPayload({ prevHash, event });
  return { ...event, prevHash, eventHash };
}

export function buildAuditHashChain(events: TraceEvent[]): AuditHashEvent[] {
  const chain: AuditHashEvent[] = [];
  let prevHash = "GENESIS";
  for (const event of events) {
    const hashed = appendAuditHash(prevHash, event);
    chain.push(hashed);
    prevHash = hashed.eventHash;
  }
  return chain;
}

export function verifyAuditHashChain(events: AuditHashEvent[]): AuditIntegrityReport {
  const failures: string[] = [];
  let prevHash = "GENESIS";
  events.forEach((event, index) => {
    if (event.prevHash !== prevHash) {
      failures.push(`event ${index} prevHash mismatch`);
    }
    const { prevHash: recordedPrevHash, eventHash: _eventHash, ...traceEvent } = event;
    const expected = hashPayload({ prevHash: recordedPrevHash, event: traceEvent });
    if (event.eventHash !== expected) {
      failures.push(`event ${index} eventHash mismatch`);
    }
    prevHash = event.eventHash;
  });
  return {
    status: failures.length === 0 ? "pass" : "fail",
    checked: events.length,
    failures
  };
}
