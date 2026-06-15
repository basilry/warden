import type { ModelAdapter, ModelRequest, ModelResponse } from "../model-adapter.ts";
import { redactPayload } from "../security/redaction.ts";

export type OpenAICompatibleConfig = {
  endpoint: string;
  model: string;
  apiKeyEnv?: string;
  dryRun?: boolean;
  liveOptIn?: boolean;
};

export function createOpenAICompatibleAdapter(config: OpenAICompatibleConfig): ModelAdapter {
  return {
    id: `openai-compatible:${config.model}`,
    kind: "openai-compatible",
    async generate<T>(request: ModelRequest): Promise<ModelResponse<T>> {
      const payload = {
        endpoint: config.endpoint,
        model: config.model,
        messages: [
          {
            role: "user",
            content: request.prompt
          }
        ],
        response_format: request.responseFormat,
        api_key_env: config.apiKeyEnv
      };

      if (config.dryRun !== false) {
        return {
          id: request.id,
          model: config.model,
          output: redactPayload(payload) as T,
          warnings: [
            "dry-run only: no network request was sent",
            "live model output would still be treated as a proposal"
          ]
        };
      }

      assertLiveModelOptIn(config);
      const apiKey = readApiKey(config.apiKeyEnv ?? "OPENAI_API_KEY");
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          input: request.prompt,
          metadata: {
            requestId: request.id,
            role: request.role,
            responseFormat: request.responseFormat
          }
        })
      });
      if (!response.ok) {
        throw new Error(`OpenAI-compatible model call failed: ${response.status} ${response.statusText}`);
      }
      return {
        id: request.id,
        model: config.model,
        output: (await response.json()) as T,
        warnings: ["live model output is treated as a proposal, never as execution authority"]
      };
    }
  };
}

export function assertLiveModelOptIn(config: OpenAICompatibleConfig): void {
  if (config.dryRun === false && config.liveOptIn !== true) {
    throw new Error("Live OpenAI-compatible model calls require explicit opt-in.");
  }
}

export function readApiKey(apiKeyEnv: string): string {
  const value = process.env[apiKeyEnv];
  if (!value) {
    throw new Error(`Missing API key environment variable: ${apiKeyEnv}`);
  }
  return value;
}
