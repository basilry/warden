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
        warnings: ["mock 모델 출력은 실행 권한이 아니라 제안입니다"]
      };
    }
  };
}

function defaultOutput(request: ModelRequest): unknown {
  if (request.role === "planner") {
    return {
      requestedTool: "run_warden_team",
      capability: "Hypothesis Analysis",
      risk: "WRITE",
      inputSummary: "Run the WARDEN team through the policy-gated runtime router.",
      input: { objective: readObjectiveFromContext(request.context) },
      rationale: "Start with deterministic ACH team analysis before requesting external evidence."
    };
  }
  if (request.role === "briefing") {
    return {
      title: "모델 보조 답변 초안",
      directAnswer:
        "모델 보조 초안: 제재 우회 비축, 공급망 교란 가설을 중심으로 검증된 범위에서 답변합니다. 외부 OSINT는 승인 전이라 반영하지 않았습니다.",
      nextSteps: ["모델 초안 제안: 승인 후 공개 출처를 확인하고 SourceVet으로 재검토합니다."]
    };
  }
  return { accepted: true, requestId: request.id };
}

function readObjectiveFromContext(context: unknown): string {
  if (context && typeof context === "object" && "objective" in context && typeof context.objective === "string") {
    return context.objective;
  }
  return "WARDEN runtime objective";
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}
