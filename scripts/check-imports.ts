import "../src/agent/index.ts";
import "../src/cli/warden.ts";
import { createBuiltInNormalRegressionCase } from "../src/agent/regression.ts";
import { prepareP1Context } from "../src/agent/p1-runner.ts";
import { buildFixedPlan } from "../src/agent/team-runner.ts";

const fixture = createBuiltInNormalRegressionCase();
const plan = buildFixedPlan("check_run", fixture.input.userRequest);
if (plan.tasks.length !== 6) {
  throw new Error(`Expected 6 P2 baseline tasks, got ${plan.tasks.length}.`);
}
const sourceVetPlan = buildFixedPlan("check_run_sv", fixture.input.userRequest, { withSourceVet: true });
if (sourceVetPlan.tasks.length !== 7) {
  throw new Error(`Expected 7 P2 SourceVet tasks, got ${sourceVetPlan.tasks.length}.`);
}
const p1 = prepareP1Context();
if (!p1.runId.startsWith("p1_")) {
  throw new Error(`Expected P1 run id, got ${p1.runId}.`);
}
console.log("Import check passed.");
