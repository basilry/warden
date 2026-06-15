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
const deterministicFetch: OsintFetchLike = async () => {
  fetchCalls += 1;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      documents: [
        {
          title: "Korea live OSINT resume sample",
          url: "https://osint.example.test/warden/supply-chain/live-resume-a",
          publishedAt: "2026-06-15T00:00:00.000Z",
          reliability: "B2",
          claims: [
            {
              text: "동북아 공급망 리스크는 수출통제와 해상 물류 병목을 함께 보는 live OSINT watchpoint로 관리해야 한다.",
              confidence: 0.72
            }
          ],
          tags: ["korea", "northeast-asia", "resume"]
        }
      ]
    })
  };
};

const state = createRuntimeState();
const run = startRuntimeRun(
  state,
  {
    objective: "대한민국 및 동북아 공급망 live OSINT 재개 검증",
    maxIterations: 2,
    answerMode: "deterministic"
  },
  { config, model: createMockModelAdapter(), osintFetchImpl: deterministicFetch }
);

await waitForRun(run);
assertEqual(run.status, "waiting_approval", "initial runtime status");

const approvalId = run.approvals.find((approval) => approval.status === "pending")?.id;
assertTruthy(approvalId, "pending approval id");

const resumed = await approveRuntimeApproval(
  state,
  run.id,
  {
    approvalId,
    actor: "live-osint-resume-regression",
    reason: "P13 regression: live OSINT opt-in uses guarded connector before SourceVet and ACH resume."
  },
  { config, osintFetchImpl: deterministicFetch }
);

assertEqual(fetchCalls, 1, "live fetch call count");
assertEqual(resumed.status, "succeeded", "resumed status");
assertEqual(resumed.outputs.resumeResult?.fetchMode, "live-osint", "resume fetch mode");
assertAtLeast(resumed.outputs.resumeResult?.fetchedUnits.length ?? 0, 1, "live fetched units");
assertAtLeast(resumed.outputs.resumeResult?.promotedBundles.length ?? 0, 1, "live promoted bundles");
assertAtLeast(resumed.outputs.resumeResult?.osintArtifacts?.length ?? 0, 2, "live artifacts");
assertIncludes(resumed.outputs.resumeResult?.fetchedUnits[0]?.tags.join(",") ?? "", "live-osint", "live unit tag");
assertIncludes(resumed.outputs.answer?.authorityRefs.join(",") ?? "", "resumeFetchMode=live-osint", "live authority ref");

console.log("WARDEN live OSINT resume regression: passed");

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
