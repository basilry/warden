import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importRunBundle, exportRunBundle, verifyBundleIntegrity } from "../src/agent/storage/bundle.ts";
import { createJsonlStorageProvider } from "../src/agent/storage/jsonl-store.ts";
import { createMemoryStorageProvider } from "../src/agent/storage/memory-store.ts";
import type { ApprovalRequest } from "../src/agent/approval.ts";
import type { CapabilityJob } from "../src/agent/jobs.ts";
import type { KnowledgeUnit, TraceEvent } from "../src/agent/types.ts";

const rootDir = mkdtempSync(join(tmpdir(), "warden-storage-regression-"));
const runId = "run_p4_storage_regression";
const storage = createJsonlStorageProvider(rootDir);

const job: CapabilityJob = {
  jobId: "job_p4_storage_regression",
  capability: "Hypothesis Analysis",
  status: "succeeded",
  currentRunId: runId,
  input: { userRequest: "storage regression" },
  history: [
    {
      ts: "2026-06-15T00:00:00.000Z",
      status: "queued",
      summary: "queued"
    },
    {
      ts: "2026-06-15T00:00:01.000Z",
      status: "succeeded",
      summary: "completed",
      ref: runId
    }
  ],
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:01.000Z"
};
const approval: ApprovalRequest = {
  id: "approval_p4_storage_regression",
  runId,
  action: {
    name: "external_osint_fetch",
    capability: "RFI Watch",
    server: "external",
    risk: "EXTERNAL"
  },
  decision: {
    decision: "require_approval",
    risk: "EXTERNAL",
    reason: "External action requires explicit approval."
  },
  requestedBy: "supervisor",
  status: "pending",
  createdAt: "2026-06-15T00:00:02.000Z"
};
const unit: KnowledgeUnit = {
  id: "ku_p4_storage_regression",
  sourceUri: "fixture://storage-regression",
  sourceType: "fixture",
  extractedAt: "2026-06-15T00:00:03.000Z",
  claims: [
    {
      id: "claim_p4_storage_regression",
      text: "Storage regression claim.",
      confidence: 0.8,
      evidenceRefs: []
    }
  ],
  provenance: {
    capturedBy: "agent",
    contentHash: "hash_p4_storage_regression",
    parserVersion: "p4-regression"
  },
  reliability: "B2",
  tags: ["p4-regression"]
};
const traceEvent: TraceEvent = {
  ts: "2026-06-15T00:00:04.000Z",
  runId,
  phase: "run_finished",
  actor: "system",
  summary: "Storage regression trace."
};

await storage.jobs.saveJob(job);
await storage.approvals.saveApproval(approval);
await storage.knowledge.saveKnowledgeUnit(unit);
await storage.traces.appendTraceEvent(traceEvent);
await storage.artifacts.writeArtifact({
  runId,
  name: "index.html",
  content: "<!doctype html><title>WARDEN P4 regression</title>",
  contentType: "text/html"
});

const restarted = createJsonlStorageProvider(rootDir);
assertEqual((await restarted.jobs.listJobs({ runId })).length, 1, "jsonl job restore");
assertEqual((await restarted.approvals.listApprovals({ runId })).length, 1, "jsonl approval restore");
assertEqual((await restarted.knowledge.listKnowledgeUnits()).length, 1, "jsonl knowledge restore");
assertEqual((await restarted.traces.listTraceEvents({ runId })).length, 1, "jsonl trace restore");
assertEqual((await restarted.artifacts.listArtifacts({ runId })).length, 1, "jsonl artifact restore");

const bundleDir = join(rootDir, "bundle");
await exportRunBundle({ runId, storage: restarted, outputDir: bundleDir });
const integrity = verifyBundleIntegrity(bundleDir);
assertEqual(integrity.ok, true, "bundle integrity");

const imported = createMemoryStorageProvider();
await importRunBundle(bundleDir, imported);
assertEqual((await imported.jobs.listJobs({ runId })).length, 1, "bundle job import");
assertEqual((await imported.approvals.listApprovals({ runId })).length, 1, "bundle approval import");
assertEqual((await imported.traces.listTraceEvents({ runId })).length, 1, "bundle trace import");

writeFileSync(join(bundleDir, "jobs.json"), "[]\n", "utf8");
const corrupted = verifyBundleIntegrity(bundleDir);
assertEqual(corrupted.ok, false, "corrupted bundle detection");

console.log("Storage regression: passed");

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
