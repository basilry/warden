import { runTeamWorkflow } from "../src/agent/team-runner.ts";
import type { RunOptions } from "../src/agent/types.ts";

const scenario = process.argv[2] ?? "normal";
const fixtureVariant = resolveFixtureVariant(scenario);
const result = await runTeamWorkflow("SourceVet을 포함해 방산 공급망 핵심 부품 수입 급감 원인을 분석해줘.", {
  withSourceVet: true,
  fixtureVariant
});

console.log(`WARDEN SourceVet demo scenario: ${scenario}`);
console.log(`Run: ${result.run.id}`);
console.log(`Status: ${result.run.status}`);
console.log(`SourceVet: ${result.outputs.sourceReview?.status ?? "not-run"}`);
console.log(
  `Source flags: ${
    result.outputs.sourceReview?.flags.map((flag) => `${flag.code}:${flag.severity}`).join(", ") || "none"
  }`
);
console.log("");
console.log(result.markdown ?? "No audit brief generated because verification failed.");

function resolveFixtureVariant(value: string): RunOptions["fixtureVariant"] {
  if (value === "uncorroborated" || value === "SV-001-independent-corroboration-required") {
    return "sourcevet_uncorroborated";
  }
  if (value === "circular" || value === "SV-002-circular-source-lineage") {
    return "sourcevet_circular";
  }
  return "normal";
}

