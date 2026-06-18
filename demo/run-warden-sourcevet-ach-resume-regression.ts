import { loadWardenConfig } from "../src/agent/config.ts";
import { createMockModelAdapter } from "../src/agent/models/mock-model.ts";
import { approveRuntimeApproval, createRuntimeState, startRuntimeRun } from "../src/runtime/loop.ts";
import type { RuntimeRun } from "../src/runtime/types.ts";

const state = createRuntimeState();
const config = loadWardenConfig({
  WARDEN_MODEL_PROVIDER: "mock",
  WARDEN_OSINT_LIVE_OPT_IN: "false"
});
const run = startRuntimeRun(
  state,
  {
    objective: "대한민국 및 동북아 공급망에 대해 알려줘",
    maxIterations: 2,
    answerMode: "deterministic"
  },
  { config, model: createMockModelAdapter() }
);

await waitForRun(run);
assertEqual(run.status, "waiting_approval", "initial runtime status");
assertTruthy(run.outputs.ach, "initial ach output");
assertAtLeast(run.outputs.ach?.survivors.length ?? 0, 1, "initial ach survivors");

const approvalId = run.approvals.find((approval) => approval.status === "pending")?.id;
assertTruthy(approvalId, "pending approval id");

const resumed = await approveRuntimeApproval(state, run.id, {
  approvalId,
  actor: "sourcevet-ach-resume-regression",
  reason: "P11 regression: approve external fetch and require SourceVet plus ACH rerun."
}, { config });

assertEqual(resumed.status, "succeeded", "resumed status");
assertTruthy(resumed.outputs.resumeResult, "resume result");
assertTruthy(resumed.outputs.resumeResult?.sourceReview, "resume source review");
assertTruthy(resumed.outputs.resumeResult?.achBefore, "resume ach before");
assertTruthy(resumed.outputs.resumeResult?.achAfter, "resume ach after");
assertAtLeast(resumed.outputs.resumeResult?.fetchedUnits.length ?? 0, 1, "resume fetched units");
assertAtLeast(resumed.outputs.resumeResult?.promotedBundles.length ?? 0, 1, "resume promoted bundles");
assertAtLeast(resumed.outputs.evidenceBundles?.length ?? 0, 1, "resumed evidence bundles");
assertIncludes(
  resumed.outputs.answer?.keyFindings.join("\n") ?? "",
  "승인 후 ACH 재평가 변화",
  "resume answer delta"
);
assertEqual(resumed.outputs.answer?.blockedActions.length ?? -1, 0, "resumed blocked actions");
assertIncludes(
  resumed.outputs.answer?.authorityRefs.join(",") ?? "",
  "resumePromotedEvidence",
  "resume authority refs"
);
assertAtLeast(
  resumed.events.filter((event) => event.type === "external.fetch_succeeded").length,
  1,
  "resume external success event"
);

console.log("WARDEN SourceVet ACH resume regression: passed");

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
