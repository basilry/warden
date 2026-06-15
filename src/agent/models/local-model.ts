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
            ? "local live execution is not wired yet; returning proposal payload"
            : "local dry-run only: no local model process was launched",
          "local model output is treated as a proposal, never as execution authority"
        ]
      };
    }
  };
}
