import { loadWardenConfig } from "../src/agent/config.ts";
import { createMockModelAdapter } from "../src/agent/models/mock-model.ts";
import type { OsintFetchLike } from "../src/connectors/osint/http-client.ts";
import { approveRuntimeApproval, createRuntimeState, startRuntimeRun } from "../src/runtime/loop.ts";
import type { RuntimeRun } from "../src/runtime/types.ts";

const config = loadWardenConfig({
  WARDEN_MODEL_PROVIDER: "mock",
  WARDEN_OSINT_LIVE_OPT_IN: "true",
  WARDEN_OSINT_TIMEOUT_MS: "50",
  WARDEN_OSINT_MAX_RESULTS: "2"
});

let fetchCalls = 0;
const failingFetch: OsintFetchLike = async () => {
  fetchCalls += 1;
  return {
    ok: false,
    status: 500,
    statusText: "fixture failure",
    text: async () => "fixture failure"
  };
};

const state = createRuntimeState();
const run = startRuntimeRun(
  state,
  {
    objective: "승인 후 OSINT 재개 실패 처리를 검증해줘",
    maxIterations: 2,
    answerMode: "deterministic"
  },
  { config, model: createMockModelAdapter(), osintFetchImpl: failingFetch }
);

await waitForRun(run);
assertEqual(run.status, "waiting_approval", "initial runtime status");

const originalAnswer = run.outputs.answer;
assertTruthy(originalAnswer, "answer before resume");

const approvalId = run.approvals.find((approval) => approval.status === "pending")?.id;
assertTruthy(approvalId, "pending approval id");

const resumed = await approveRuntimeApproval(
  state,
  run.id,
  {
    approvalId,
    actor: "resume-failure-regression",
    reason: "P15 regression: approved resume failure must close run cleanly."
  },
  { config, osintFetchImpl: failingFetch }
);

assertAtLeast(fetchCalls, 1, "live fetch call count");
assertEqual(resumed.status, "failed", "resumed status");
assertIncludes(resumed.error ?? "", "승인 후 런타임 재개 실패", "resume error");
assertEqual(resumed.approvals[0]?.status, "approved", "approval status");
assertTruthy(resumed.completedAt, "completed at");
assertTruthy(resumed.outputs.answer, "answer after resume failure");
assertIncludes(resumed.outputs.answer?.warnings.join("\n") ?? "", "승인 후 런타임 재개 실패", "answer warning");
assertTruthy(resumed.events.find((event) => event.type === "run.resume_failed"), "resume failed event");
assertTruthy(resumed.events.find((event) => event.type === "run.failed"), "run failed event");

console.log("WARDEN resume failure regression: passed");

async function waitForRun(run: RuntimeRun): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!["queued", "running"].includes(run.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`runtime run did not finish: ${run.id}`);
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

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
