import { loadWardenConfig } from "../src/agent/config.ts";
import { createWardenRuntimeServer } from "../src/runtime/server.ts";

const config = loadWardenConfig({ WARDEN_MODEL_PROVIDER: "mock" });
const { server } = createWardenRuntimeServer({ config, silent: true });

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Runtime server did not bind to a TCP port.");
}
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const health = await fetchJson(`${baseUrl}/healthz`);
  assertEqual(health.ok, true, "healthz");

  const created = await fetchJson(`${baseUrl}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objective: "Runtime smoke test for WARDEN server.",
      maxIterations: 2
    })
  });
  const runId = created.run.id;
  const run = await waitForRun(baseUrl, runId);

  assertEqual(run.status, "waiting_approval", "runtime status");
  assertEqual(run.outputs.teamStatus, undefined, "team run is deferred until approval");
  assertAtLeast(run.outputs.investigationPlan?.hypotheses?.length ?? 0, 3, "investigation plan hypotheses");
  assertAtLeast(run.approvals.length, 1, "approval count");
  assertAtLeast(run.events.filter((event: { type: string }) => event.type === "investigation.plan").length, 1, "investigation plan events");
  assertAtLeast(run.events.filter((event: { type: string }) => event.type === "mcp.tool_call").length, 1, "mcp tool call events");

  const approvalId = run.approvals[0]?.id;
  if (!approvalId) {
    throw new Error("runtime run did not expose approval id");
  }
  const resumed = await fetchJson(`${baseUrl}/runs/${runId}/approvals/${approvalId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actor: "runtime-regression",
      reason: "Runtime server regression approval."
    })
  });
  assertEqual(resumed.status, "succeeded", "resumed runtime status");
  assertAtLeast(resumed.outputs.fetchedEvidence?.length ?? 0, 1, "resumed fetched evidence count");
  assertEqual(resumed.outputs.answer.blockedActions.length, 0, "resumed blocked action count");

  console.log("Runtime server regression: passed");
} finally {
  server.close();
}

async function waitForRun(baseUrl: string, runId: string): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await fetchJson(`${baseUrl}/runs/${runId}`);
    if (!["queued", "running"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Runtime run did not finish: ${runId}`);
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) {
    throw new Error(`${label} failed: expected at least ${expected} actual=${actual}`);
  }
}
