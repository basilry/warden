import {
  formatValidationIssues,
  validateMcpToolResultEnvelope,
  type McpResultValidation,
  type McpResultValidationFamily,
  type McpResultValidator
} from "./mcp-result-validation.ts";

export type McpBoundaryStatus = "succeeded" | "blocked" | "failed";

export type McpBoundaryToolResult<TOutput = unknown> = {
  status: McpBoundaryStatus;
  output?: TOutput;
  error?: string;
  observationTrusted: false;
};

export type McpInvoker<TInput, TOutput> = (
  input: TInput
) => McpBoundaryToolResult<TOutput> | Promise<McpBoundaryToolResult<TOutput>>;

export type McpInvokerAdapter<TName extends string, TInput, TOutput> = {
  toolName: TName;
  family?: McpResultValidationFamily;
  invoke: McpInvoker<TInput, TOutput>;
  validateOutput: McpResultValidator<TOutput>;
};

export type AnyMcpInvokerAdapter = McpInvokerAdapter<string, any, any>;

export type McpInvokerAdapterMap = Record<string, AnyMcpInvokerAdapter>;

export type McpAdapterInput<TAdapter> = TAdapter extends McpInvokerAdapter<string, infer TInput, any>
  ? TInput
  : never;

export type McpAdapterOutput<TAdapter> = TAdapter extends McpInvokerAdapter<string, any, infer TOutput>
  ? TOutput
  : never;

export type McpBoundaryCollectionGapWarning = {
  kind: "collection_gap";
  code: "mcp_collection_gap";
  source: "mcp_boundary";
  toolName: string;
  status: Exclude<McpBoundaryStatus, "succeeded"> | "malformed_result" | "adapter_exception";
  summary: string;
  message: string;
  retryable: boolean;
  capturedAt: string;
};

export type McpBoundaryInvokeOptions = {
  collectErrorWarnings?: boolean;
  now?: () => string;
};

export type McpBoundaryResult<TOutput = unknown> =
  | {
      status: "succeeded";
      output: TOutput;
      observationTrusted: false;
      boundaryWarnings?: McpBoundaryCollectionGapWarning[];
    }
  | {
      status: "blocked" | "failed";
      error: string;
      observationTrusted: false;
      boundaryWarnings?: McpBoundaryCollectionGapWarning[];
      validation?: McpResultValidation;
    };

export type McpOrchestrator<TAdapters extends McpInvokerAdapterMap> = {
  invoke<TName extends keyof TAdapters & string>(
    toolName: TName,
    input: McpAdapterInput<TAdapters[TName]>,
    options?: McpBoundaryInvokeOptions
  ): Promise<McpBoundaryResult<McpAdapterOutput<TAdapters[TName]>>>;
  invokeUnknown(
    toolName: string,
    input: unknown,
    options?: McpBoundaryInvokeOptions
  ): Promise<McpBoundaryResult<unknown>>;
};

export function defineMcpInvokerAdapter<TName extends string, TInput, TOutput>(
  adapter: McpInvokerAdapter<TName, TInput, TOutput>
): McpInvokerAdapter<TName, TInput, TOutput> {
  return adapter;
}

export function createMcpOrchestrator<TAdapters extends McpInvokerAdapterMap>(
  adapters: TAdapters
): McpOrchestrator<TAdapters> {
  assertAdapterKeysMatchToolNames(adapters);

  return {
    async invoke(toolName, input, options) {
      return invokeWithAdapter(adapters[toolName], input, options);
    },
    async invokeUnknown(toolName, input, options) {
      const adapter = adapters[toolName];
      if (!adapter) {
        return failedBoundaryResult({
          toolName,
          status: "failed",
          error: `No MCP invoker adapter registered for tool ${toolName}.`,
          options
        });
      }
      return invokeWithAdapter(adapter, input, options);
    }
  };
}

export function mcpErrorToCollectionGapWarning(input: {
  toolName: string;
  status: Exclude<McpBoundaryStatus, "succeeded"> | "malformed_result" | "adapter_exception";
  error: string;
  now?: () => string;
}): McpBoundaryCollectionGapWarning {
  const message = `MCP tool ${input.toolName} did not return usable evidence: ${input.error}`;
  return {
    kind: "collection_gap",
    code: "mcp_collection_gap",
    source: "mcp_boundary",
    toolName: input.toolName,
    status: input.status,
    summary: `${input.toolName} evidence collection gap`,
    message,
    retryable: isRetryableMcpError(input.error),
    capturedAt: (input.now ?? (() => new Date().toISOString()))()
  };
}

async function invokeWithAdapter<TInput, TOutput>(
  adapter: McpInvokerAdapter<string, TInput, TOutput>,
  input: TInput,
  options: McpBoundaryInvokeOptions = {}
): Promise<McpBoundaryResult<TOutput>> {
  let rawResult: unknown;
  try {
    rawResult = await adapter.invoke(input);
  } catch (error) {
    return failedBoundaryResult({
      toolName: adapter.toolName,
      status: "failed",
      warningStatus: "adapter_exception",
      error: normalizeError(error),
      options
    });
  }

  const envelopeValidation = validateMcpToolResultEnvelope(rawResult, `MCP tool ${adapter.toolName} result`);
  if (!envelopeValidation.ok) {
    return failedBoundaryResult({
      toolName: adapter.toolName,
      status: "failed",
      warningStatus: "malformed_result",
      error: `Malformed MCP response for ${adapter.toolName}: ${formatValidationIssues(envelopeValidation.issues)}`,
      options,
      validation: envelopeValidation
    });
  }

  const result = rawResult as McpBoundaryToolResult<TOutput>;
  if (result.status !== "succeeded") {
    return failedBoundaryResult({
      toolName: adapter.toolName,
      status: result.status,
      error: result.error ?? `MCP tool ${adapter.toolName} returned ${result.status}.`,
      options
    });
  }

  const outputValidation = adapter.validateOutput(result.output as TOutput, {
    toolName: adapter.toolName,
    family: adapter.family
  });
  if (!outputValidation.ok) {
    return failedBoundaryResult({
      toolName: adapter.toolName,
      status: "failed",
      warningStatus: "malformed_result",
      error: `Malformed MCP output for ${adapter.toolName}: ${formatValidationIssues(outputValidation.issues)}`,
      options,
      validation: outputValidation
    });
  }

  return {
    status: "succeeded",
    output: result.output as TOutput,
    observationTrusted: false
  };
}

function failedBoundaryResult(input: {
  toolName: string;
  status: "blocked" | "failed";
  warningStatus?: McpBoundaryCollectionGapWarning["status"];
  error: string;
  options?: McpBoundaryInvokeOptions;
  validation?: McpResultValidation;
}): McpBoundaryResult<never> {
  return {
    status: input.status,
    error: input.error,
    observationTrusted: false,
    validation: input.validation,
    boundaryWarnings: input.options?.collectErrorWarnings
      ? [
          mcpErrorToCollectionGapWarning({
            toolName: input.toolName,
            status: input.warningStatus ?? input.status,
            error: input.error,
            now: input.options.now
          })
        ]
      : undefined
  };
}

function assertAdapterKeysMatchToolNames(adapters: McpInvokerAdapterMap): void {
  for (const [key, adapter] of Object.entries(adapters)) {
    if (key !== adapter.toolName) {
      throw new Error(`MCP adapter key ${key} does not match toolName ${adapter.toolName}.`);
    }
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unknown MCP adapter error.";
}

function isRetryableMcpError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("rate") ||
    normalized.includes("temporar") ||
    normalized.includes("network") ||
    normalized.includes("unavailable")
  );
}
