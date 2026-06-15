import type { WardenConfig } from "../config.ts";
import type { ModelAdapter } from "../model-adapter.ts";
import { createCodexCliModelAdapter } from "./codex-cli.ts";
import { createLocalModelAdapter } from "./local-model.ts";
import { createMockModelAdapter } from "./mock-model.ts";
import { createOpenAICompatibleAdapter } from "./openai-compatible.ts";

export function createModelAdapterFromConfig(config: WardenConfig["model"]): ModelAdapter {
  if (config.provider === "mock") {
    return createMockModelAdapter();
  }
  if (config.provider === "openai-compatible") {
    return createOpenAICompatibleAdapter(config.openaiCompatible);
  }
  if (config.provider === "codex") {
    return createCodexCliModelAdapter(config.codex);
  }
  if (config.provider === "local") {
    return createLocalModelAdapter(config.local);
  }
  throw new Error(`Unsupported model provider: ${String(config.provider)}`);
}
