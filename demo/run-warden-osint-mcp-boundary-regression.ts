import { loadWardenConfig } from "../src/agent/config.ts";
import type { ApprovalRequest } from "../src/agent/approval.ts";
import type { OsintSearchMcpInvoker } from "../src/agent/mcp/osint-client.ts";
import type { KnowledgeUnit } from "../src/agent/types.ts";
import type { OsintFetchLike } from "../src/connectors/osint/http-client.ts";
import { resumeApprovedExternalFetchRun } from "../src/runtime/resume.ts";
import type { RuntimeRun } from "../src/runtime/types.ts";

const runId = "runtime_p17_mcp_boundary";
const approvalId = "approval_p17_mcp_boundary";
const capturedAt = "2026-06-15T00:00:00.000Z";
const objective = "대한민국 및 동북아 공급망 MCP boundary resume 검증";

const config = loadWardenConfig({
  WARDEN_MODEL_PROVIDER: "mock",
  WARDEN_OSINT_LIVE_OPT_IN: "true",
  WARDEN_OSINT_MAX_RESULTS: "2",
  WARDEN_OSINT_TIMEOUT_MS: "50"
});

let mcpCalls = 0;
let fetchCalls = 0;
let observedQuery = "";

const mcpUnit: KnowledgeUnit = {
  id: "ku_p17_mcp_boundary_1",
  sourceUri: "https://example.com/mcp-boundary/supply-chain-report",
  sourceType: "html",
  extractedAt: capturedAt,
  claims: [
    {
      id: "claim_p17_mcp_boundary_1",
      text: "MCP boundary sample reports supply-chain controls and logistics bottlenecks affecting Northeast Asia.",
      confidence: 0.86,
      evidenceRefs: ["https://example.com/mcp-boundary/supply-chain-report"]
    }
  ],
  provenance: {
    capturedBy: "connector",
    originalLocation: "https://example.com/mcp-boundary/supply-chain-report",
    contentHash: "p17-mcp-boundary-hash",
    parserVersion: "warden-osint-mcp-boundary-regression/v1"
  },
  reliability: "B2",
  tags: ["mcp-boundary", "natural-language-search", "sourcevet-required"]
};

const osintSearchInvoker: OsintSearchMcpInvoker = async (input) => {
  mcpCalls += 1;
  observedQuery = input.query;
  assertEqual(input.runId, runId, "mcp input run id");
  assertEqual(input.approvalId, approvalId, "mcp input approval id");
  assertEqual(input.maxResults, 2, "mcp max results");
  return {
    status: "succeeded",
    output: {
      result: {
        status: "succeeded",
        units: [mcpUnit],
        artifacts: [
          {
            id: "artifact_p17_mcp_boundary_raw",
            type: "raw",
            sourceUri: "https://example.com/mcp-boundary/supply-chain-report",
            capturedAt,
            contentHash: "artifact-p17-mcp-boundary-raw",
            payload: { source: "mock-mcp", title: "MCP boundary sample" }
          }
        ],
        warnings: ["mock MCP OSINT search path"]
      }
    },
    observationTrusted: false
  };
};

const osintFetchImpl: OsintFetchLike = async () => {
  fetchCalls += 1;
  throw new Error("direct OSINT fetch fallback should not run when MCP invoker is configured");
};

const resumed = await resumeApprovedExternalFetchRun(makeRun(), makeApproval(), {
  osint: config.osint,
  osintFetchImpl,
  osintSearchInvoker
});

assertEqual(mcpCalls, 1, "mcp invoker call count");
assertEqual(fetchCalls, 0, "direct fetch call count");
assertEqual(observedQuery, objective, "mcp query");
assertEqual(resumed.status, "succeeded", "resumed status");
assertEqual(resumed.outputs.resumeResult?.fetchMode, "live-osint", "resume fetch mode");
assertIncludes(resumed.outputs.resumeResult?.fetchedUnits[0]?.tags.join(",") ?? "", "mcp-boundary", "mcp unit tag");
assertIncludes(resumed.outputs.answer?.authorityRefs.join(",") ?? "", "resumeFetchMode=live-osint", "resume authority ref");
assertIncludes(resumed.outputs.resumeResult?.fetchWarnings?.join("\n") ?? "", "mock MCP", "mcp warning");

console.log("WARDEN OSINT MCP boundary regression: passed");

function makeRun(): RuntimeRun {
  return {
    id: runId,
    objective,
    status: "running",
    createdAt: capturedAt,
    updatedAt: capturedAt,
    maxIterations: 2,
    iteration: 2,
    withSourceVet: false,
    answerMode: "deterministic",
    events: [],
    modelResponses: [],
    toolResults: [
      {
        iteration: 2,
        toolName: "external_osint_fetch",
        status: "blocked",
        error: "Approval required for external_osint_fetch."
      }
    ],
    approvals: [makeApproval()],
    outputs: {}
  };
}

function makeApproval(): ApprovalRequest {
  return {
    id: approvalId,
    runId,
    action: {
      name: "external_osint_fetch",
      capability: "RFI Watch",
      server: "external",
      risk: "EXTERNAL",
      input: { query: objective }
    },
    decision: {
      decision: "require_approval",
      risk: "EXTERNAL",
      reason: "External calls are blocked until human approval."
    },
    requestedBy: "supervisor",
    status: "approved",
    createdAt: capturedAt,
    resolvedAt: capturedAt,
    resolvedBy: "p17-regression",
    reason: "P17 MCP boundary regression approval."
  };
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
