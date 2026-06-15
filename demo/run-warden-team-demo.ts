import { renderTraceTimeline } from "../src/agent/audit.ts";
import { runTeamWorkflow } from "../src/agent/team-runner.ts";

const userRequest =
  process.argv.slice(2).join(" ") || "가상 방산 공급망 핵심 부품 수입 급감의 원인을 분석하고 생존 가설과 RFI를 제안해줘.";

const result = await runTeamWorkflow(userRequest, {
  fixtureVariant: "normal",
  writeArtifacts: process.argv.includes("--write-artifacts")
});

console.log("\nWARDEN P0 Team Demo");
console.log("==================");
console.log(`Run ID: ${result.run.id}`);
console.log(`Status: ${result.run.status}`);
console.log(`Trace Events: ${result.traceSummary.eventCount}`);
console.log(`Tool Calls: ${result.traceSummary.toolCalls.join(", ")}`);

if (result.markdown) {
  console.log("\n" + result.markdown);
}

console.log("\nTrace Timeline");
console.log("--------------");
console.log(renderTraceTimeline(result.trace));

if (result.run.status !== "succeeded") {
  process.exitCode = 1;
}
