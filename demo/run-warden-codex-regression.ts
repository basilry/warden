import { loadWardenConfig } from "../src/agent/config.ts";
import { createModelRequest } from "../src/agent/model-adapter.ts";
import { createModelAdapterFromConfig } from "../src/agent/models/provider.ts";
import { runP1Workflow } from "../src/agent/p1-runner.ts";

const config = loadWardenConfig({
  WARDEN_MODEL_PROVIDER: "codex",
  WARDEN_CODEX_DRY_RUN: "1"
});
const model = createModelAdapterFromConfig(config.model);
const response = await model.generate<Record<string, unknown>>(
  createModelRequest({
    role: "planner",
    prompt: "Create a WARDEN dry-run plan.",
    context: { regression: "codex-dry-run" },
    responseFormat: "json"
  })
);

if (model.kind !== "codex") {
  throw new Error(`Expected codex model kind, got ${model.kind}`);
}
if (response.output.provider !== "codex-cli") {
  throw new Error("Expected dry-run codex-cli payload.");
}
if (!Array.isArray(response.output.args) || !response.output.args.includes("exec")) {
  throw new Error("Expected codex exec command arguments in dry-run payload.");
}

const result = await runP1Workflow("WARDEN Codex dry-run regression.", { model });
if (result.job.status !== "succeeded" || result.p0Result.run.status !== "succeeded") {
  throw new Error("Codex dry-run P1 workflow did not succeed.");
}

console.log("Codex dry-run regression: passed");
