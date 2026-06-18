import {
  createLocalRagRegistry,
  retrieveLocalRagContext,
  summarizeLocalRagRegistry
} from "../../connectors/rag/retrieval.ts";
import { loadLocalRagCorpus } from "../../connectors/rag/corpus.ts";
import type { LocalRagCorpus } from "../../connectors/rag/types.ts";
import {
  isRagMcpToolName,
  type RagMcpInputByTool,
  type RagMcpOutputByTool,
  type RagMcpToolName,
  type RetrieveContextInput,
  type SummarizeCorpusInput
} from "./types.ts";

export type RagMcpToolDeps = {
  corpus?: LocalRagCorpus;
  corpusPath?: string;
};

export function dispatchRagToolCall<TName extends RagMcpToolName>(
  name: TName,
  input: RagMcpInputByTool[TName],
  deps: RagMcpToolDeps = {}
): RagMcpOutputByTool[TName] {
  if (name === "retrieve_context") {
    const parsed = parseRetrieveContextInput(input);
    const registry = loadRegistry(parsed.corpusPath, deps);
    const result = retrieveLocalRagContext(parsed.query, registry.index, {
      limit: parsed.limit,
      minScore: parsed.minScore,
      requiredTags: parsed.requiredTags
    });
    return {
      result,
      units: result.units
    } as RagMcpOutputByTool[TName];
  }

  if (name === "summarize_corpus") {
    const parsed = parseSummarizeCorpusInput(input);
    const registry = loadRegistry(parsed.corpusPath, deps);
    return {
      summary: summarizeLocalRagRegistry(registry, parsed.tags)
    } as RagMcpOutputByTool[TName];
  }

  throw new Error(`Unsupported RAG MCP tool: ${String(name)}`);
}

export function dispatchUnknownRagToolCall(name: string, input: unknown, deps: RagMcpToolDeps = {}): unknown {
  if (!isRagMcpToolName(name)) {
    throw new Error(`Unknown RAG MCP tool: ${name}`);
  }
  return dispatchRagToolCall(name, input as never, deps);
}

function loadRegistry(corpusPath: string | undefined, deps: RagMcpToolDeps) {
  if (deps.corpus) return createLocalRagRegistry(deps.corpus);
  return createLocalRagRegistry(loadLocalRagCorpus(corpusPath ?? deps.corpusPath));
}

function parseRetrieveContextInput(input: unknown): Required<Pick<RetrieveContextInput, "query">> &
  Pick<RetrieveContextInput, "corpusPath" | "limit" | "minScore" | "requiredTags"> {
  if (!isRecord(input)) {
    throw new Error("retrieve_context requires an object input.");
  }
  return {
    query: parseNonEmptyString(input.query, "query"),
    corpusPath: parseOptionalString(input.corpusPath, "corpusPath"),
    limit: input.limit === undefined ? undefined : parseLimit(input.limit),
    minScore: input.minScore === undefined ? undefined : parseMinScore(input.minScore),
    requiredTags: parseOptionalStringArray(input.requiredTags, "requiredTags")
  };
}

function parseSummarizeCorpusInput(input: unknown): Pick<SummarizeCorpusInput, "corpusPath" | "tags"> {
  if (input === undefined) return {};
  if (!isRecord(input)) {
    throw new Error("summarize_corpus requires an object input.");
  }
  return {
    corpusPath: parseOptionalString(input.corpusPath, "corpusPath"),
    tags: parseOptionalStringArray(input.tags, "tags")
  };
}

function parseLimit(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 25) {
    throw new Error("limit must be an integer from 1 to 25.");
  }
  return value as number;
}

function parseMinScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("minScore must be a number from 0 to 100.");
  }
  return value;
}

function parseOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a string array.`);
  }
  return value.map((item) => parseNonEmptyString(item, label));
}

function parseOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return parseNonEmptyString(value, label);
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
