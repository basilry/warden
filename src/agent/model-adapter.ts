import { newId } from "./ids.ts";

export type ModelRole = "planner" | "framer" | "curator" | "briefing" | "verifier";

export type ModelRequest = {
  id: string;
  role: ModelRole;
  prompt: string;
  context: unknown;
  responseFormat: "text" | "json";
};

export type ModelResponse<T = unknown> = {
  id: string;
  model: string;
  output: T;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  warnings: string[];
};

export type ModelAdapter = {
  id: string;
  kind: "mock" | "openai-compatible" | "codex" | "local";
  generate<T>(request: ModelRequest): Promise<ModelResponse<T>>;
};

export function createModelRequest(args: Omit<ModelRequest, "id">): ModelRequest {
  return {
    id: newId("model_req"),
    ...args
  };
}

export function assertModelResponseShape<T>(
  response: ModelResponse<T>,
  predicate: (output: T) => boolean,
  message = "Model response shape assertion failed."
): void {
  if (!predicate(response.output)) {
    throw new Error(message);
  }
}

export function renderModelRequestForAudit(request: ModelRequest): string {
  return [
    `model_request=${request.id}`,
    `role=${request.role}`,
    `format=${request.responseFormat}`,
    `prompt=${request.prompt.slice(0, 160)}`
  ].join(" ");
}
