import type { KnowledgeUnit } from "../../agent/types.ts";

export type LocalCorpusClaim = {
  id: string;
  text: string;
  confidence?: number;
  evidenceRefs?: string[];
};

export type LocalCorpusEntry = {
  id: string;
  title: string;
  uri?: string;
  sourceType?: KnowledgeUnit["sourceType"];
  extractedAt?: string;
  reliability?: string;
  tags: string[];
  claims: LocalCorpusClaim[];
};

export type LocalRagCorpus = {
  corpusId: string;
  version: string;
  title: string;
  description?: string;
  entries: LocalCorpusEntry[];
};

export type LocalRagRetrievalOptions = {
  limit?: number;
  minScore?: number;
  requiredTags?: string[];
};

export type LocalRagRetrievedItem = {
  unit: KnowledgeUnit;
  score: number;
  matchedTerms: string[];
  matchedTags: string[];
  snippets: string[];
};

export type LocalRagRetrievalResult = {
  query: string;
  normalizedQuery: string;
  units: KnowledgeUnit[];
  items: LocalRagRetrievedItem[];
  warnings: string[];
};

export type LocalRagCorpusSummary = {
  corpusId: string;
  title: string;
  version: string;
  unitCount: number;
  claimCount: number;
  tags: string[];
  reliability: Record<string, number>;
  description?: string;
};
