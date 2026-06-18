import type { KnowledgeUnit, Risk } from "../../agent/types.ts";
import type { LocalRagCorpusSummary, LocalRagRetrievalResult } from "../../connectors/rag/types.ts";

export const RAG_MCP_TOOL_NAMES = ["retrieve_context", "summarize_corpus"] as const;

export type RagMcpToolName = (typeof RAG_MCP_TOOL_NAMES)[number];

export type RetrieveContextInput = {
  query: string;
  corpusPath?: string;
  limit?: number;
  minScore?: number;
  requiredTags?: string[];
};

export type RetrieveContextOutput = {
  result: LocalRagRetrievalResult;
  units: KnowledgeUnit[];
};

export type SummarizeCorpusInput = {
  corpusPath?: string;
  tags?: string[];
};

export type SummarizeCorpusOutput = {
  summary: LocalRagCorpusSummary;
};

export type RagMcpInputByTool = {
  retrieve_context: RetrieveContextInput;
  summarize_corpus: SummarizeCorpusInput;
};

export type RagMcpOutputByTool = {
  retrieve_context: RetrieveContextOutput;
  summarize_corpus: SummarizeCorpusOutput;
};

export function isRagMcpToolName(value: string): value is RagMcpToolName {
  return (RAG_MCP_TOOL_NAMES as readonly string[]).includes(value);
}

export function getRagMcpToolRisk(_toolName: RagMcpToolName): Risk {
  return "READ";
}
