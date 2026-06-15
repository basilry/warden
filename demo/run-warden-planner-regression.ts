import { createMockModelAdapter } from "../src/agent/models/mock-model.ts";
import { createRuntimeState, startRuntimeRun } from "../src/runtime/loop.ts";
import type { RuntimeRun } from "../src/runtime/types.ts";

const valid = await runWithPlanner();
assertPlannerSource(valid, "model_proposal", "valid proposal should be selected");

const invalidJson = await runWithPlanner("{not-json");
assertPlannerSource(invalidJson, "deterministic_fallback", "invalid JSON should fallback");
assertPlannerWarning(invalidJson, "missing or invalid");

const rawToolString = await runWithPlanner("CALL_TOOL external_osint_fetch");
assertPlannerSource(rawToolString, "deterministic_fallback", "raw tool call string should fallback");
assertPlannerWarning(rawToolString, "missing or invalid");

const unknownTool = await runWithPlanner({
  requestedTool: "unknown_tool",
  capability: "Hypothesis Analysis",
  risk: "WRITE",
  inputSummary: "Attempt to call unknown tool."
});
assertPlannerSource(unknownTool, "deterministic_fallback", "unknown tool should fallback");
assertPlannerWarning(unknownTool, "unknown tool");

const destructive = await runWithPlanner({
  requestedTool: "run_warden_team",
  capability: "Hypothesis Analysis",
  risk: "DESTRUCTIVE",
  inputSummary: "Attempt destructive action."
});
assertPlannerSource(destructive, "deterministic_fallback", "destructive proposal should fallback");
assertPlannerWarning(destructive, "blocked risk");

console.log("WARDEN planner regression: passed");

async function runWithPlanner(planner?: unknown): Promise<RuntimeRun> {
  const state = createRuntimeState();
  const run = startRuntimeRun(
    state,
    {
      objective: "Planner regression supply-chain objective.",
      maxIterations: 1
    },
    {
      model: createMockModelAdapter(planner ? { planner } : undefined)
    }
  );
  await waitForRun(run);
  return run;
}

async function waitForRun(run: RuntimeRun): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!["queued", "running"].includes(run.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`runtime run did not finish: ${run.id}`);
}

function assertPlannerSource(run: RuntimeRun, expected: string, label: string): void {
  const event = run.events.find((item) => item.type === "mcp.tool_start");
  const source = isRecord(event?.data) ? event.data.plannerSource : undefined;
  if (source !== expected) {
    throw new Error(`${label}: expected=${expected} actual=${String(source)}\n${JSON.stringify(run.events, null, 2)}`);
  }
}

function assertPlannerWarning(run: RuntimeRun, expectedSubstring: string): void {
  const event = run.events.find((item) => item.type === "mcp.tool_start");
  const warnings = isRecord(event?.data) && Array.isArray(event.data.plannerWarnings) ? event.data.plannerWarnings : [];
  if (!warnings.some((warning) => String(warning).includes(expectedSubstring))) {
    throw new Error(`planner warning missing "${expectedSubstring}": ${JSON.stringify(warnings)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
