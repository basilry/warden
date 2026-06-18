import { createApprovalQueue } from "../src/agent/approval.ts";
import { loadWardenConfig } from "../src/agent/config.ts";
import { createMockModelAdapter } from "../src/agent/models/mock-model.ts";
import type { RuntimeRun } from "../src/runtime/types.ts";
import { approvePendingApproval, rejectPendingApproval } from "../src/runtime/approval-actions.ts";
import { fetchApprovedExternalOsint } from "../src/runtime/external-fetch.ts";
import {
  approveRuntimeApproval as approveRuntimeRunApproval,
  createRuntimeState,
  startRuntimeRun
} from "../src/runtime/loop.ts";

const runId = "runtime_p9_regression";
const approvalQueue = createApprovalQueue();
const pendingApproval = approvalQueue.submit({
  runId,
  action: {
    name: "external_osint_fetch",
    capability: "RFI Watch",
    server: "external",
    risk: "EXTERNAL",
    input: { query: "대한민국 및 동북아 공급망" }
  },
  decision: {
    decision: "require_approval",
    risk: "EXTERNAL",
    reason: "External calls are blocked until human approval."
  },
  requestedBy: "supervisor"
});

const run = makeRun(runId, [pendingApproval]);

assertThrows(
  () =>
    fetchApprovedExternalOsint({
      query: "대한민국 및 동북아 공급망",
      approval: pendingApproval,
      runId
    }),
  "pending approval must not fetch"
);

const approved = approvePendingApproval(run, {
  approvalId: pendingApproval.id,
  actor: "operator",
  reason: "P9 regression approved deterministic local fetch.",
  now: "2026-06-15T00:00:00.000Z"
});

assertEqual(approved.approval.status, "approved", "approval status");
assertEqual(approved.run.status, "running", "approved run status");
assertEqual(approved.resumeReady, true, "resume readiness");
assertEqual(approved.remainingPending.length, 0, "remaining pending approvals");
assertIncludes(
  approved.run.events.map((event) => event.type).join(","),
  "run.resume_ready",
  "resume event"
);

const units = fetchApprovedExternalOsint({
  query: "대한민국 및 동북아 공급망",
  approval: approved.approval,
  runId: approved.run.id,
  limit: 2
});

assertEqual(units.length, 2, "approved fetch unit count");
assertIncludes(units[0].tags.join(","), "approved-external-fetch", "approved fetch tag");
assertIncludes(units[0].claims[0]?.text ?? "", "대한민국", "approved fetch claim");

const rejected = rejectPendingApproval(run, {
  approvalId: pendingApproval.id,
  actor: "operator",
  reason: "P9 regression rejection.",
  now: "2026-06-15T00:01:00.000Z"
});

assertEqual(rejected.approval.status, "denied", "rejected approval status");
assertEqual(rejected.run.status, "failed", "rejected run status");
assertIncludes(rejected.run.error ?? "", "Approval denied", "rejected run error");

const state = createRuntimeState();
const deterministicConfig = loadWardenConfig({ WARDEN_MODEL_PROVIDER: "mock", WARDEN_OSINT_LIVE_OPT_IN: "false" });
const runtimeRun = startRuntimeRun(
  state,
  {
    objective: "대한민국 및 동북아 공급망에 대해 알려줘",
    maxIterations: 2,
    answerMode: "deterministic"
  },
  {
    model: createMockModelAdapter(),
    config: deterministicConfig
  }
);
await waitForRun(runtimeRun);
assertEqual(runtimeRun.status, "waiting_approval", "runtime approval wait status");
assertAtLeast(runtimeRun.approvals.length, 1, "runtime pending approval count");
assertIncludes(runtimeRun.outputs.answer?.blockedActions.join("\n") ?? "", "external_osint_fetch", "runtime blocked action");

const resumed = await approveRuntimeRunApproval(state, runtimeRun.id, {
  approvalId: runtimeRun.approvals[0]?.id,
  actor: "operator",
  reason: "P9 regression runtime approval.",
  toolName: undefined
}, { config: deterministicConfig });
assertEqual(resumed.status, "succeeded", "resumed runtime status");
assertAtLeast(resumed.outputs.fetchedEvidence?.length ?? 0, 1, "resumed fetched evidence count");
assertEqual(resumed.outputs.answer?.blockedActions.length ?? -1, 0, "resumed blocked action count");
assertIncludes(resumed.outputs.answer?.authorityRefs.join(",") ?? "", "승인외부근거", "resumed authority refs");

console.log("WARDEN approval resume regression: passed");

function makeRun(id: string, approvals: RuntimeRun["approvals"]): RuntimeRun {
  const now = "2026-06-15T00:00:00.000Z";
  return {
    id,
    objective: "대한민국 및 동북아 공급망에 대해 알려줘",
    status: "waiting_approval",
    createdAt: now,
    updatedAt: now,
    maxIterations: 2,
    iteration: 2,
    withSourceVet: false,
    answerMode: "deterministic",
    events: [],
    modelResponses: [],
    toolResults: [
      {
        iteration: 2,
        toolName: "external_osint_fetch",
        status: "blocked",
        error: "Approval required for external_osint_fetch."
      }
    ],
    approvals,
    outputs: {}
  };
}

function assertThrows(fn: () => unknown, label: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label}: expected throw`);
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertAtLeast(actual: number, minimum: number, label: string): void {
  if (actual < minimum) {
    throw new Error(`${label} failed: expected >= ${minimum} actual=${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}

async function waitForRun(run: RuntimeRun): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!["queued", "running"].includes(run.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`runtime run did not finish: ${run.id}`);
}
