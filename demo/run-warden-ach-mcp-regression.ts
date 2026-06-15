import { readFileSync } from "node:fs";
import { runTeamWorkflow } from "../src/agent/team-runner.ts";
import { invokeAchMcpTool } from "../src/agent/mcp/ach-client.ts";
import type { McpServerConfig } from "../src/agent/mcp/types.ts";

const result = await runTeamWorkflow("ACH MCP regression supply-chain objective.", {
  withSupervisor: false,
  withBriefing: false,
  withSourceVet: false
});

assertEqual(result.run.status, "succeeded", "team status");
assertAtLeast(result.outputs.ach?.survivors.length ?? 0, 1, "survivor count");
assertTraceIncludes(result.trace, "tool_call", "open_case");
assertTraceIncludes(result.trace, "tool_call", "add_evidence");
assertTraceIncludes(result.trace, "tool_call", "assess");
assertTraceIncludes(result.trace, "tool_call", "rank_hypotheses");

const achAnalystSource = readFileSync("src/agent/agents/ach-analyst.ts", "utf8");
assertNotIncludes(achAnalystSource, "../tools/ach-local", "AchAnalyst direct ACH import");
assertNotIncludes(achAnalystSource, "createAchLocalTool", "AchAnalyst local tool factory");

const malformed = await invokeAchMcpTool(
  "open_case",
  { frame: result.outputs.caseFrame! },
  { config: makeFixtureConfig("malformed", 1000) }
);
assertEqual(malformed.status, "failed", "malformed MCP status");
assertIncludes(malformed.error ?? "", "Malformed MCP response", "malformed MCP error");

const timeout = await invokeAchMcpTool(
  "open_case",
  { frame: result.outputs.caseFrame! },
  { config: makeFixtureConfig("slow", 1) }
);
assertEqual(timeout.status, "failed", "timeout MCP status");
assertIncludes(timeout.error ?? "", "timed out", "timeout MCP error");

const unknown = await invokeAchMcpTool(
  "open_case",
  { frame: result.outputs.caseFrame! },
  {
    config: {
      ...makeFixtureConfig("echo", 1000),
      allowTools: ["rank_hypotheses"]
    }
  }
);
assertEqual(unknown.status, "failed", "allowlist rejection status");
assertIncludes(unknown.error ?? "", "not allowed", "allowlist rejection error");

console.log("WARDEN ACH MCP regression: passed");

function makeFixtureConfig(mode: "echo" | "malformed" | "slow", timeoutMs: number): McpServerConfig {
  return {
    id: `fixture-${mode}`,
    mode: "stdio",
    enabled: true,
    command: process.execPath,
    args: ["fixtures/mcp/warden-stdio-fixture.mjs", "--mode", mode],
    allowTools: ["open_case", "add_evidence", "assess", "rank_hypotheses"],
    commandAllowlist: [process.execPath],
    timeoutMs,
    risk: "WRITE"
  };
}

function assertTraceIncludes(
  trace: Array<{ phase: string; ref?: string }>,
  phase: string,
  ref: string
): void {
  if (!trace.some((event) => event.phase === phase && event.ref === ref)) {
    throw new Error(`trace missing ${phase}:${ref}`);
  }
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertNotIncludes(value: string, unexpected: string, label: string): void {
  if (value.includes(unexpected)) {
    throw new Error(`${label} unexpectedly included: ${unexpected}`);
  }
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) {
    throw new Error(`${label} failed: expected at least ${expected} actual=${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
