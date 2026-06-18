import { loadWardenConfig } from "../src/agent/config.ts";
import { createMockModelAdapter } from "../src/agent/models/mock-model.ts";
import { createRuntimeState, startRuntimeRun } from "../src/runtime/loop.ts";
import type { RuntimeRun } from "../src/runtime/types.ts";

const state = createRuntimeState();
const run = startRuntimeRun(
  state,
  {
    objective: "중국의 대만 침공 가능성",
    maxIterations: 2,
    answerMode: "deterministic"
  },
  {
    model: createMockModelAdapter(),
    config: loadWardenConfig({ WARDEN_MODEL_PROVIDER: "mock", WARDEN_OSINT_LIVE_OPT_IN: "false" })
  }
);

await waitForRun(run);

assertEqual(run.status, "waiting_approval", "runtime status");
assertTruthy(run.outputs.securityReport, "security report");
assertTruthy(run.outputs.domainExpansion, "domain expansion");
assertTruthy(run.outputs.ragContext, "rag context");
assertTruthy(run.outputs.claimGraph, "claim graph");
assertTruthy(run.outputs.forecast, "forecast products");
assertTruthy(run.outputs.investigationPlan, "investigation plan");
assertIncludes(run.outputs.securityReport?.title ?? "", "중국의 대만 침공 가능성", "report title");
assertEqual(run.outputs.securityReport?.confidence.level, "low", "pending approval confidence");
assertIncludes(run.outputs.securityReport?.analysis.items.join("\n") ?? "", "온톨로지 확장", "pre-approval scenario analysis");
assertIncludes(run.outputs.securityReport?.forecast.items.join("\n") ?? "", "P24 예측", "forecast engine output");
assertIncludes(run.outputs.securityReport?.collectionGaps.items.join("\n") ?? "", "승인 전까지 실시간 근거", "approval collection gap");
assertIncludes(run.outputs.securityReport?.sourceAuthorityRefs.join(",") ?? "", "분석도메인", "authority refs");

console.log("WARDEN security report regression: passed");

async function waitForRun(run: RuntimeRun): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!["queued", "running"].includes(run.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`runtime run did not finish: ${run.id}`);
}

function assertTruthy(value: unknown, label: string): void {
  if (!value) {
    throw new Error(`${label} failed`);
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
