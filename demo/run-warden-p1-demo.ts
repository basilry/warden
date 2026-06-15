import { runP1Workflow } from "../src/agent/p1-runner.ts";

const userRequest =
  process.argv.slice(2).join(" ") || "가상 방산 공급망 핵심 부품 수입 급감의 원인을 P1 하네스로 분석해줘.";

const result = await runP1Workflow(userRequest);
console.log(result.summary);

if (result.job.status !== "succeeded" || result.pendingApprovals.length === 0 || result.p0Result.run.status !== "succeeded") {
  process.exitCode = 1;
}
