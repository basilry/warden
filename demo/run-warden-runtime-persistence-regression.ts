import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadWardenConfig } from "../src/agent/config.ts";
import { createMockModelAdapter } from "../src/agent/models/mock-model.ts";
import { approveRuntimeApproval, getRuntimeRun, startRuntimeRun } from "../src/runtime/loop.ts";
import { createWardenRuntimeServer } from "../src/runtime/server.ts";
import { getRuntimeRepository } from "../src/runtime/storage.ts";
import type { RuntimeRun } from "../src/runtime/types.ts";

const rootDir = mkdtempSync(join(tmpdir(), "warden-runtime-persistence-"));
const config = loadWardenConfig({
  WARDEN_MODEL_PROVIDER: "mock",
  WARDEN_OSINT_LIVE_OPT_IN: "false",
  WARDEN_STORAGE: "jsonl",
  WARDEN_STORAGE_DIR: rootDir
});

const firstServer = createWardenRuntimeServer({ config, silent: true });
const created = startRuntimeRun(
  firstServer.state,
  {
    objective: "대한민국 및 동북아 공급망에 대해 알려줘",
    maxIterations: 2,
    answerMode: "deterministic"
  },
  { config, model: createMockModelAdapter() }
);

await waitForRun(created);
assertEqual(created.status, "waiting_approval", "created status");
assertAtLeast(created.approvals.filter((approval) => approval.status === "pending").length, 1, "created pending approvals");

const firstRepository = getRuntimeRepository(firstServer.state);
assertTruthy(firstRepository, "first repository");
assertEqual(firstRepository?.loadRun(created.id)?.status, "waiting_approval", "persisted waiting approval status");
assertAtLeast(firstRepository?.listEvents(created.id).length ?? 0, 1, "persisted event count");

const secondServer = createWardenRuntimeServer({ config, silent: true });
const restored = getRuntimeRun(secondServer.state, created.id);
assertTruthy(restored, "restored run");
assertEqual(restored?.status, "waiting_approval", "restored status");
assertAtLeast(restored?.events.length ?? 0, 1, "restored events");

const approvalId = restored?.approvals.find((approval) => approval.status === "pending")?.id;
assertTruthy(approvalId, "restored pending approval id");

const approved = await approveRuntimeApproval(secondServer.state, created.id, {
  approvalId,
  actor: "runtime-persistence-regression",
  reason: "Restart simulation approved restored pending runtime action."
}, { config });

assertEqual(approved.status, "succeeded", "approved restored status");
assertAtLeast(approved.outputs.fetchedEvidence?.length ?? 0, 1, "approved fetched evidence");

const secondRepository = getRuntimeRepository(secondServer.state);
const persistedAfterApprove = secondRepository?.loadRun(created.id);
assertEqual(persistedAfterApprove?.status, "succeeded", "persisted approved status");
assertAtLeast(
  secondRepository?.listEvents(created.id).filter((event) => event.type === "approval.resolved").length ?? 0,
  1,
  "persisted approval event"
);

await assertRejects(
  () =>
    approveRuntimeApproval(secondServer.state, created.id, {
      approvalId,
      actor: "runtime-persistence-regression",
      reason: "Duplicate approve should fail."
    }),
  "duplicate approve"
);

console.log("WARDEN runtime persistence regression: passed");

async function waitForRun(run: RuntimeRun): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!["queued", "running"].includes(run.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`runtime run did not finish: ${run.id}`);
}

async function assertRejects(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${label}: expected rejection`);
}

function assertTruthy<T>(value: T, label: string): asserts value is NonNullable<T> {
  if (!value) {
    throw new Error(`${label} failed: expected truthy value`);
  }
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) {
    throw new Error(`${label} failed: expected at least ${expected} actual=${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
