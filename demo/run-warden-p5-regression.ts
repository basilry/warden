import { buildAuditHashChain, verifyAuditHashChain } from "../src/agent/security/audit-integrity.ts";
import { assertNoEgressWithoutApproval, evaluateEgressPolicy } from "../src/agent/security/egress-policy.ts";
import { assertNoSecretInPayload, redactPayload } from "../src/agent/security/redaction.ts";
import { validateModelOutputAgainstAuthority } from "../src/agent/security/output-validator.ts";
import { createMcpRequest } from "../src/agent/mcp/protocol.ts";
import { routeToolCallWithPolicy } from "../src/agent/mcp/router.ts";
import { createStdioMcpClient, invokeRemoteTool } from "../src/agent/mcp/stdio-client.ts";
import type { McpServerConfig } from "../src/agent/mcp/types.ts";
import { createLocalCapabilityRegistry } from "../src/agent/mcp/local-registry.ts";
import { createModelRequest } from "../src/agent/model-adapter.ts";
import { createLocalModelAdapter } from "../src/agent/models/local-model.ts";
import { createOpenAICompatibleAdapter } from "../src/agent/models/openai-compatible.ts";
import { ingestDocument } from "../src/agent/knowledge/ingest.ts";
import { createApprovalQueue } from "../src/agent/approval.ts";
import { createPolicyEngine } from "../src/agent/policy.ts";
import { createTraceRecorder } from "../src/agent/audit.ts";
import type { ToolCallPlan, TraceEvent } from "../src/agent/types.ts";

await expectRejects(
  () =>
    createOpenAICompatibleAdapter({
      endpoint: "https://api.openai.com/v1/responses",
      model: "gpt-5.4",
      dryRun: false,
      liveOptIn: false
    }).generate(createModelRequest({ role: "planner", prompt: "live", context: {}, responseFormat: "json" })),
  "live opt-in guard"
);

await expectRejects(
  () =>
    createOpenAICompatibleAdapter({
      endpoint: "https://api.openai.com/v1/responses",
      model: "gpt-5.4",
      apiKeyEnv: "WARDEN_MISSING_TEST_KEY",
      dryRun: false,
      liveOptIn: true
    }).generate(createModelRequest({ role: "planner", prompt: "live", context: {}, responseFormat: "json" })),
  "api key presence guard"
);

const redacted = redactPayload({ apiKey: "sk-testsecret1234567890", nested: { token: "Bearer codex_secret1234567890" } });
assertNoSecretInPayload(redacted);

const egressCall: ToolCallPlan = {
  id: "p5-egress",
  toolName: "external_osint_fetch",
  capability: "RFI Watch",
  risk: "EXTERNAL",
  inputSummary: "External fetch.",
  requestedBy: "supervisor"
};
const egressDecision = evaluateEgressPolicy(egressCall, { runId: "p5", role: "supervisor" });
assertNoEgressWithoutApproval(egressCall, egressDecision);

const authority = validateModelOutputAgainstAuthority(
  {
    survivors: ["model invented survivor"],
    ranking: ["model invented survivor", "deterministic survivor"],
    tool_calls: [{ name: "external_osint_fetch" }]
  },
  {
    achSurvivors: ["deterministic survivor"],
    achRanking: ["deterministic survivor", "alternative hypothesis"]
  }
);
assertEqual(authority.status, "fail", "authority validator status");

const local = createLocalModelAdapter();
const localResponse = await local.generate<Record<string, unknown>>(
  createModelRequest({ role: "planner", prompt: "local dry-run", context: {}, responseFormat: "json" })
);
assertEqual(localResponse.model, "local-model-candidate", "local model candidate");

const mcpConfig: McpServerConfig = {
  id: "fixture-mcp",
  mode: "stdio",
  enabled: true,
  command: "node",
  args: ["fixtures/mcp/warden-stdio-fixture.mjs"],
  allowTools: ["fixture_echo"],
  commandAllowlist: ["node"],
  timeoutMs: 1000,
  risk: "READ"
};
const client = createStdioMcpClient(mcpConfig);
const tools = await client.discoverRemoteTools();
assertEqual(tools.length, 1, "stdio discovery");
const mcpResult = await client.invokeRemoteTool("fixture_echo", { ok: true });
assertEqual(mcpResult.status, "succeeded", "stdio invoke");

const timeoutResult = await invokeRemoteTool(
  { config: { ...mcpConfig, args: ["fixtures/mcp/warden-stdio-fixture.mjs", "--mode", "slow"], timeoutMs: 20 } },
  "fixture_echo",
  {}
);
assertEqual(timeoutResult.status, "failed", "stdio timeout fail closed");

const malformedResult = await invokeRemoteTool(
  { config: { ...mcpConfig, args: ["fixtures/mcp/warden-stdio-fixture.mjs", "--mode", "malformed"] } },
  "fixture_echo",
  {}
);
assertEqual(malformedResult.status, "failed", "stdio malformed fail closed");

const approvals = createApprovalQueue();
const policyRouted = await routeToolCallWithPolicy(
  {
    id: "p5-external-mcp",
    toolName: "fixture_echo",
    capability: "fixture_echo",
    risk: "EXTERNAL",
    inputSummary: "External MCP fixture call.",
    requestedBy: "supervisor",
    input: { external: true }
  },
  {
    local: createLocalCapabilityRegistry(),
    remotes: [createStdioMcpClient({ ...mcpConfig, risk: "EXTERNAL" })],
    allowlist: ["fixture_echo"]
  },
  {
    runId: "p5",
    role: "supervisor",
    policy: createPolicyEngine(),
    approvals,
    trace: createTraceRecorder("p5")
  }
);
assertEqual(policyRouted.status, "blocked", "external mcp approval pending");
assertEqual(approvals.listPending("p5").length, 1, "external mcp approval queued");

const textIngest = ingestDocument("fixtures/documents/sample.txt", { tags: ["p5-doc"] });
const htmlIngest = ingestDocument("fixtures/documents/sample.html", { tags: ["p5-doc"] });
const pdfIngest = ingestDocument("fixtures/documents/sample.pdf", { tags: ["p5-doc"] });
assertAtLeast(textIngest.units.length, 1, "text ingestion units");
assertAtLeast(htmlIngest.units.length, 1, "html ingestion units");
assertAtLeast(pdfIngest.warnings.length, 1, "pdf parser warning");

const chain = buildAuditHashChain([
  {
    ts: "2026-06-15T00:00:00.000Z",
    runId: "p5",
    phase: "run_started",
    actor: "system",
    summary: "started"
  } satisfies TraceEvent
]);
assertEqual(verifyAuditHashChain(chain).status, "pass", "audit hash pass");
assertEqual(verifyAuditHashChain([{ ...chain[0], summary: "tampered" }]).status, "fail", "audit hash tamper");

console.log("P5 regression: passed");

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

async function expectRejects(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${label} did not reject.`);
}
