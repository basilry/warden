import { loadWardenConfig } from "../src/agent/config.ts";
import { createModelAdapterFromConfig } from "../src/agent/models/provider.ts";
import { runP1Workflow } from "../src/agent/p1-runner.ts";

const userRequest =
  "가상 방산 공급망 핵심 부품 수입 급감의 원인을 분석하기 위한 WARDEN 계획을 Codex 인증 경로로 제안해줘.";

const config = loadWardenConfig({
  ...process.env,
  WARDEN_MODEL_PROVIDER: "codex",
  WARDEN_CODEX_DRY_RUN: process.env.WARDEN_CODEX_DRY_RUN ?? "1"
});
const model = createModelAdapterFromConfig(config.model);
const result = await runP1Workflow(userRequest, { model });

console.log("WARDEN P5 Codex Model Demo");
console.log("==========================");
console.log(`Model adapter: ${model.id}`);
console.log(`Dry run: ${config.model.codex.dryRun}`);
console.log(`Job: ${result.job.jobId}`);
console.log(`Status: ${result.job.status}`);
console.log(`Approvals pending: ${result.pendingApprovals.length}`);
console.log(`P0 run: ${result.p0Result.run.id} (${result.p0Result.run.status})`);

if (result.job.status !== "succeeded" || result.p0Result.run.status !== "succeeded") {
  process.exitCode = 1;
}
