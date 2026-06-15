import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runP1Workflow } from "../src/agent/p1-runner.ts";
import { buildWardenReport } from "../src/agent/report/build-report.ts";
import { printReportLocation, resolveReportOutputDir, writeReportArtifacts } from "../src/agent/report/html-report.ts";
import {
  createBuiltInNormalRegressionCase,
  loadRegressionCases,
  runRegressionSuite
} from "../src/agent/regression.ts";
import { runTeamWorkflow } from "../src/agent/team-runner.ts";

const userRequest =
  "가상 방산 공급망 핵심 부품 수입 급감의 원인을 분석하고, 출처 검증과 승인 대기 상태까지 감사 리포트로 정리해줘.";

const p1Result = await runP1Workflow(userRequest);
const p2Result = await runTeamWorkflow(userRequest, {
  withSourceVet: true,
  fixtureVariant: "normal"
});

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, "../fixtures/regression");
const regressionResults = await runRegressionSuite([createBuiltInNormalRegressionCase(), ...loadRegressionCases(fixtureDir)]);

const report = buildWardenReport({
  teamResult: p2Result,
  p1Result,
  regressionResults
});
const artifact = writeReportArtifacts(resolveReportOutputDir(report.runId), report);

console.log("WARDEN P3 Report Demo");
console.log("=====================");
console.log(`Status: ${report.status}`);
console.log(`Run: ${report.runId}`);
console.log(`Approvals pending: ${report.approvalPanel.pendingCount}`);
console.log(`Regression: ${report.regressionPanel?.passed}/${report.regressionPanel?.total} passed`);
console.log(printReportLocation(artifact));

if (p2Result.run.status !== "succeeded") {
  process.exitCode = 1;
}

