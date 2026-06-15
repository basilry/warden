import type { ModelAdapter, ModelRequest, ModelResponse, ModelRole } from "../model-adapter.ts";

export type MockModelFixtures = Partial<Record<ModelRole, unknown>>;

export function createMockModelAdapter(fixtures: MockModelFixtures = {}): ModelAdapter {
  return {
    id: "mock-model",
    kind: "mock",
    async generate<T>(request: ModelRequest): Promise<ModelResponse<T>> {
      const output = (fixtures[request.role] ?? defaultOutput(request)) as T;
      return {
        id: request.id,
        model: "mock-deterministic-v1",
        output,
        usage: {
          inputTokens: estimateTokens(request.prompt),
          outputTokens: estimateTokens(JSON.stringify(output))
        },
        warnings: ["mock model output is a proposal, not an execution authority"]
      };
    }
  };
}

function defaultOutput(request: ModelRequest): unknown {
  if (request.role === "planner") {
    return {
      proposedCapability: "Hypothesis Analysis",
      proposedSteps: ["ingest knowledge", "resolve capability", "run P0 team", "verify", "brief"],
      externalActionSuggested: true
    };
  }
  if (request.role === "briefing") {
    return { tone: "audit", shouldOverrideDeterministicResult: false };
  }
  return { accepted: true, requestId: request.id };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}
