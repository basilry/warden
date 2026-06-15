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
  assertEqual(run.outputs.teamStatus, "succeeded", "team status");
  assertAtLeast(run.approvals.length, 1, "approval count");
  assertAtLeast(run.events.filter((event: { type: string }) => event.type === "model.proposal").length, 1, "model proposal events");
  assertAtLeast(run.events.filter((event: { type: string }) => event.type === "mcp.tool_call").length, 1, "mcp tool call events");

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
