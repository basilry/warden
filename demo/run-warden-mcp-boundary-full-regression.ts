import {
  createMcpOrchestrator,
  defineMcpInvokerAdapter,
  mcpErrorToCollectionGapWarning,
  type McpBoundaryToolResult
} from "../src/runtime/mcp-orchestrator.ts";
import {
  validateAchMcpResultEnvelope,
  validateForecastMcpResultEnvelope,
  validateOsintMcpResultEnvelope,
  validateRagMcpResultEnvelope
} from "../src/runtime/mcp-result-validation.ts";

type FakeOsintInput = {
  query: string;
  runId: string;
  approvalId: string;
};

type FakeOsintOutput = {
  result: {
    status: "succeeded" | "blocked";
    units: unknown[];
    artifacts: unknown[];
    warnings: string[];
    sourceVetRequired?: true;
    promoteToAch?: false;
  };
};

type FakeRagInput = {
  query: string;
};

type FakeRagOutput = {
  result: unknown;
  units?: unknown;
};

type FakeAchInput = {
  caseId: string;
};

type FakeAchOutput = {
  result: unknown;
};

type FakeForecastInput = {
  questionId: string;
};

type FakeForecastOutput = {
  estimate: unknown;
};

const capturedAt = "2026-06-18T00:00:00.000Z";

let osintCalls = 0;
let ragCalls = 0;
let achCalls = 0;
let forecastCalls = 0;

const orchestrator = createMcpOrchestrator({
  search_news: defineMcpInvokerAdapter({
    toolName: "search_news",
    family: "osint",
    validateOutput: validateOsintMcpResultEnvelope,
    async invoke(input: FakeOsintInput): Promise<McpBoundaryToolResult<FakeOsintOutput>> {
      osintCalls += 1;
      assertEqual(input.runId, "run_p27_boundary", "OSINT run id");
      return {
        status: "succeeded",
        output: makeOsintOutput(),
        observationTrusted: false
      };
    }
  }),
  retrieve_context: defineMcpInvokerAdapter({
    toolName: "retrieve_context",
    family: "rag",
    validateOutput: validateRagMcpResultEnvelope,
    async invoke(_input: FakeRagInput): Promise<McpBoundaryToolResult<FakeRagOutput>> {
      ragCalls += 1;
      return {
        status: "succeeded",
        output: {
          result: {
            query: "malformed boundary fixture",
            units: "not-an-array",
            warnings: []
          },
          units: []
        },
        observationTrusted: false
      };
    }
  }),
  rank_hypotheses: defineMcpInvokerAdapter({
    toolName: "rank_hypotheses",
    family: "ach",
    validateOutput: validateAchMcpResultEnvelope,
    async invoke(_input: FakeAchInput): Promise<McpBoundaryToolResult<FakeAchOutput>> {
      achCalls += 1;
      return {
        status: "failed",
        error: "ACH MCP timed out before ranking hypotheses.",
        observationTrusted: false
      };
    }
  }),
  calculate_forecast: defineMcpInvokerAdapter({
    toolName: "calculate_forecast",
    family: "forecast",
    validateOutput: validateForecastMcpResultEnvelope,
    async invoke(input: FakeForecastInput): Promise<McpBoundaryToolResult<FakeForecastOutput>> {
      forecastCalls += 1;
      return {
        status: "succeeded",
        output: makeForecastOutput(input.questionId),
        observationTrusted: false
      };
    }
  })
});

const osint = await orchestrator.invoke("search_news", {
  query: "P27 MCP boundary hardening",
  runId: "run_p27_boundary",
  approvalId: "approval_p27_boundary"
});
assertEqual(osintCalls, 1, "OSINT call count");
assertEqual(osint.status, "succeeded", "OSINT boundary status");
if (osint.status !== "succeeded") throw new Error(osint.error);
assertEqual(osint.output.result.units.length, 1, "OSINT unit count");
assertIncludes(osint.output.result.warnings.join("\n"), "fake OSINT", "OSINT warning");

const forecast = await orchestrator.invoke("calculate_forecast", {
  questionId: "forecast_p27_boundary"
});
assertEqual(forecastCalls, 1, "forecast call count");
assertEqual(forecast.status, "succeeded", "forecast boundary status");
if (forecast.status !== "succeeded") throw new Error(forecast.error);
assertEqual(readProbability(forecast.output.estimate), 0.42, "forecast probability");

const rag = await orchestrator.invoke("retrieve_context", {
  query: "malformed boundary fixture"
});
assertEqual(ragCalls, 1, "RAG call count");
assertEqual(rag.status, "failed", "malformed RAG boundary status");
if (rag.status !== "failed") throw new Error("malformed RAG result unexpectedly passed");
assertIncludes(rag.error, "Malformed MCP output", "malformed RAG error");
assertIncludes(rag.error, "$.result.units", "malformed RAG issue path");

const ach = await orchestrator.invoke(
  "rank_hypotheses",
  { caseId: "case_p27_boundary" },
  {
    collectErrorWarnings: true,
    now: () => capturedAt
  }
);
assertEqual(achCalls, 1, "ACH call count");
assertEqual(ach.status, "failed", "ACH MCP error status");
if (ach.status !== "failed") throw new Error("ACH error unexpectedly passed");
assertEqual(ach.boundaryWarnings?.[0]?.kind, "collection_gap", "ACH warning kind");
assertEqual(ach.boundaryWarnings?.[0]?.source, "mcp_boundary", "ACH warning source");
assertEqual(ach.boundaryWarnings?.[0]?.retryable, true, "ACH warning retryable");
assertIncludes(ach.boundaryWarnings?.[0]?.message ?? "", "timed out", "ACH warning message");

const directGap = mcpErrorToCollectionGapWarning({
  toolName: "search_news",
  status: "failed",
  error: "network unavailable",
  now: () => capturedAt
});
assertEqual(directGap.kind, "collection_gap", "direct gap kind");
assertEqual(directGap.retryable, true, "direct gap retryable");

console.log("WARDEN MCP boundary full regression: passed");

function makeOsintOutput(): FakeOsintOutput {
  return {
    result: {
      status: "succeeded",
      units: [
        {
          id: "ku_p27_boundary_1",
          sourceUri: "https://example.com/p27/mcp-boundary",
          sourceType: "html",
          extractedAt: capturedAt,
          claims: [
            {
              id: "claim_p27_boundary_1",
              text: "P27 fake OSINT output is validated before runtime consumption.",
              confidence: 0.82,
              evidenceRefs: ["https://example.com/p27/mcp-boundary"]
            }
          ],
          provenance: {
            capturedBy: "connector",
            originalLocation: "https://example.com/p27/mcp-boundary",
            contentHash: "p27-boundary-content-hash",
            parserVersion: "p27-mcp-boundary-regression/v1"
          },
          reliability: "B2",
          tags: ["mcp-boundary", "osint"]
        }
      ],
      artifacts: [
        {
          id: "artifact_p27_boundary_1",
          type: "raw",
          sourceUri: "https://example.com/p27/mcp-boundary",
          capturedAt,
          contentHash: "p27-boundary-artifact-hash",
          payload: { title: "P27 MCP Boundary" }
        }
      ],
      warnings: ["fake OSINT result must still pass boundary validation"],
      sourceVetRequired: true,
      promoteToAch: false
    }
  };
}

function makeForecastOutput(questionId: string): FakeForecastOutput {
  const horizon = {
    label: "six months",
    months: 6,
    startDate: "2026-06-18",
    endDate: "2026-12-18"
  };
  const baseRate = {
    questionId,
    horizon,
    horizonMonths: 6,
    referenceClass: "boundary regression",
    annualProbability: 0.36,
    probability: 0.2,
    probabilityRange: { lower: 0.12, upper: 0.29 },
    confidence: "medium",
    rationale: ["fake base rate for P27 boundary validation"]
  };
  const indicatorAssessment = {
    scores: [],
    netScore: 0.22,
    supportScore: 0.25,
    dragScore: 0.03,
    confidence: 0.7,
    rationale: ["fake indicator assessment for P27 boundary validation"]
  };
  return {
    estimate: {
      question: {
        id: questionId,
        text: "Will the P27 boundary forecast fixture validate?",
        eventType: "boundary_regression"
      },
      horizon,
      baseRate,
      indicatorAssessment,
      probability: 0.42,
      probabilityRange: { lower: 0.31, upper: 0.53 },
      confidenceBand: { lower: 0.31, upper: 0.53, label: "medium", width: 0.22 },
      adjustment: 0.22,
      rationale: ["fake forecast estimate for P27 boundary validation"]
    }
  };
}

function readProbability(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("probability" in value)) {
    throw new Error("forecast estimate missing probability");
  }
  const probability = value.probability;
  if (typeof probability !== "number") {
    throw new Error("forecast probability is not a number");
  }
  return probability;
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
