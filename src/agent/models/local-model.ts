import type { ModelAdapter, ModelRequest, ModelResponse } from "../model-adapter.ts";
import { redactPayload } from "../security/redaction.ts";

export type LocalModelConfig = {
  endpoint?: string;
  model?: string;
  dryRun?: boolean;
};

export function createLocalModelAdapter(config: LocalModelConfig = {}): ModelAdapter {
  const model = config.model ?? "local-model-candidate";
  return {
    id: `local:${model}`,
    kind: "local",
    async generate<T>(request: ModelRequest): Promise<ModelResponse<T>> {
      const payload = {
        provider: "local",
        endpoint: config.endpoint ?? "local-runtime",
        model,
        request: redactPayload({
          role: request.role,
          prompt: request.prompt,
          context: request.context,
          responseFormat: request.responseFormat
        })
      };

      return {
        id: request.id,
        model,
        output: payload as T,
        warnings: [
          config.dryRun === false
            ? "로컬 실시간 실행은 아직 연결되지 않아 제안 payload를 반환합니다"
            : "로컬 dry-run 모드라 모델 프로세스를 실행하지 않았습니다",
          "로컬 모델 출력은 실행 권한이 아니라 제안으로만 취급됩니다"
        ]
      };
    }
  };
}
