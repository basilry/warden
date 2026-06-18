import type { KnowledgeUnit } from "../../agent/types.ts";
import {
  buildKnowledgeUnitsFromCorpus,
  loadLocalRagCorpus,
  summarizeKnowledgeUnits
} from "./corpus.ts";
import type {
  LocalRagCorpus,
  LocalRagCorpusSummary,
  LocalRagRetrievalOptions,
  LocalRagRetrievalResult,
  LocalRagRetrievedItem
} from "./types.ts";

type IndexedDocument = {
  unit: KnowledgeUnit;
  normalizedText: string;
  termFrequency: Map<string, number>;
  length: number;
};

export type LocalRagIndex = {
  corpusId: string;
  units: KnowledgeUnit[];
  documents: IndexedDocument[];
  documentFrequency: Map<string, number>;
  averageDocumentLength: number;
};

export type LocalRagRegistry = {
  corpus: LocalRagCorpus;
  units: KnowledgeUnit[];
  index: LocalRagIndex;
};

const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SCORE = 0.01;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
  "about",
  "into",
  "can",
  "should"
]);

export function createLocalRagRegistry(corpus = loadLocalRagCorpus()): LocalRagRegistry {
  const units = buildKnowledgeUnitsFromCorpus(corpus);
  return {
    corpus,
    units,
    index: createLocalRagIndex(units, corpus.corpusId)
  };
}

export function createLocalRagIndex(units: KnowledgeUnit[], corpusId = "local-rag-corpus"): LocalRagIndex {
  const documents = units.map((unit) => {
    const normalizedText = normalizeRagText(buildRagDocumentText(unit));
    const termFrequency = buildTermFrequency(tokenizeRagText(normalizedText));
    const length = [...termFrequency.values()].reduce((total, count) => total + count, 0);
    return { unit, normalizedText, termFrequency, length };
  });
  const documentFrequency = buildDocumentFrequency(documents);
  const totalLength = documents.reduce((total, document) => total + document.length, 0);
  return {
    corpusId,
    units,
    documents,
    documentFrequency,
    averageDocumentLength: documents.length === 0 ? 0 : totalLength / documents.length
  };
}

export function indexDocument(index: LocalRagIndex, unit: KnowledgeUnit): LocalRagIndex {
  const nextUnits = [...index.units.filter((item) => item.id !== unit.id), unit].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  return createLocalRagIndex(nextUnits, index.corpusId);
}

export function retrieveLocalRagContext(
  query: string,
  index: LocalRagIndex,
  options: LocalRagRetrievalOptions = {}
): LocalRagRetrievalResult {
  const normalizedQuery = normalizeRagText(query);
  const queryTokens = tokenizeRagText(normalizedQuery);
  const requiredTags = new Set(options.requiredTags ?? []);
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const scored = index.documents
    .filter((document) => hasRequiredTags(document.unit, requiredTags))
    .map((document) => scoreDocument(document, queryTokens, index))
    .filter((item) => item.score >= minScore)
    .sort(compareRetrievedItems)
    .slice(0, limit);

  return {
    query,
    normalizedQuery,
    units: scored.map((item) => item.unit),
    items: scored,
    warnings: buildWarnings(query, index, scored)
  };
}

export function summarizeLocalRagRegistry(registry: LocalRagRegistry, tags: string[] = []): LocalRagCorpusSummary {
  return summarizeKnowledgeUnits(registry.corpus, registry.units, tags);
}

export function renderLocalRagRetrievalSummary(result: LocalRagRetrievalResult): string {
  if (result.items.length === 0) return `No local RAG results for: ${result.query}`;
  return result.items
    .map((item, index) => {
      const tags = item.matchedTags.length > 0 ? ` tags=${item.matchedTags.join(",")}` : "";
      const snippet = item.snippets[0] ?? "(no snippet)";
      return `${index + 1}. ${item.unit.id} score=${item.score.toFixed(3)}${tags} :: ${snippet}`;
    })
    .join("\n");
}

export function buildRagDocumentText(unit: KnowledgeUnit): string {
  const tagAliases = unit.tags.flatMap((tag) => tag.split(/[:_/.-]/g));
  return [
    unit.id,
    unit.sourceUri,
    unit.reliability,
    ...unit.tags,
    ...tagAliases,
    ...unit.claims.flatMap((claim) => [claim.id, claim.text, ...claim.evidenceRefs])
  ].join(" ");
}

export function normalizeRagText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeRagText(value: string): string[] {
  const normalized = normalizeRagText(value);
  if (!normalized) return [];
  const tokens: string[] = [];
  for (const part of normalized.split(" ")) {
    if (!part || STOPWORDS.has(part)) continue;
    tokens.push(part);
    if (containsHangul(part)) {
      tokens.push(...buildCharacterNgrams(part, 2));
    }
  }
  return tokens;
}

function scoreDocument(
  document: IndexedDocument,
  queryTokens: string[],
  index: LocalRagIndex
): LocalRagRetrievedItem {
  const uniqueQueryTokens = [...new Set(queryTokens)];
  const matchedTerms = uniqueQueryTokens.filter((token) => document.termFrequency.has(token)).sort();
  const matchedTags = matchTags(document.unit.tags, uniqueQueryTokens);
  if (matchedTerms.length === 0 && matchedTags.length === 0) {
    return {
      unit: document.unit,
      score: 0,
      matchedTerms,
      matchedTags,
      snippets: []
    };
  }
  const lexicalScore = uniqueQueryTokens.reduce(
    (total, token) => total + scoreToken(token, document, index),
    0
  );
  const tagScore = matchedTags.length === 0 ? 0 : matchedTags.length * 0.35;
  const reliabilityScore = reliabilityToScore(document.unit.reliability) * 0.08;
  const score = Number((lexicalScore + tagScore + reliabilityScore).toFixed(6));
  return {
    unit: document.unit,
    score,
    matchedTerms,
    matchedTags,
    snippets: buildSnippets(document.unit, matchedTerms)
  };
}

function scoreToken(token: string, document: IndexedDocument, index: LocalRagIndex): number {
  const frequency = document.termFrequency.get(token) ?? 0;
  if (frequency === 0) return 0;
  const documentCount = Math.max(1, index.documents.length);
  const documentFrequency = index.documentFrequency.get(token) ?? 0;
  const idf = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
  const denominator =
    frequency +
    BM25_K1 *
      (1 -
        BM25_B +
        BM25_B *
          (document.length / Math.max(1, index.averageDocumentLength)));
  return idf * ((frequency * (BM25_K1 + 1)) / denominator);
}

function buildTermFrequency(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function buildDocumentFrequency(documents: IndexedDocument[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const document of documents) {
    for (const token of document.termFrequency.keys()) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return counts;
}

function hasRequiredTags(unit: KnowledgeUnit, requiredTags: Set<string>): boolean {
  if (requiredTags.size === 0) return true;
  return [...requiredTags].every((tag) => unit.tags.includes(tag));
}

function matchTags(tags: string[], queryTokens: string[]): string[] {
  const queryTokenSet = new Set(queryTokens);
  return tags
    .filter((tag) => tokenizeRagText(tag).some((token) => queryTokenSet.has(token)))
    .sort();
}

function buildSnippets(unit: KnowledgeUnit, matchedTerms: string[]): string[] {
  if (matchedTerms.length === 0) return unit.claims.map((claim) => claim.text);
  return unit.claims
    .filter((claim) => {
      const claimTokens = new Set(tokenizeRagText(claim.text));
      return matchedTerms.some((term) => claimTokens.has(term));
    })
    .map((claim) => claim.text);
}

function compareRetrievedItems(left: LocalRagRetrievedItem, right: LocalRagRetrievedItem): number {
  if (right.score !== left.score) return right.score - left.score;
  const reliabilityDiff = reliabilityToScore(right.unit.reliability) - reliabilityToScore(left.unit.reliability);
  if (reliabilityDiff !== 0) return reliabilityDiff;
  return left.unit.id.localeCompare(right.unit.id);
}

function buildWarnings(
  query: string,
  index: LocalRagIndex,
  items: LocalRagRetrievedItem[]
): string[] {
  const warnings: string[] = [];
  if (!query.trim()) warnings.push("Query is empty.");
  if (index.units.length === 0) warnings.push("Local RAG index has no KnowledgeUnits.");
  if (items.length === 0) warnings.push("No local RAG KnowledgeUnits met the retrieval threshold.");
  return warnings;
}

function reliabilityToScore(reliability: string | undefined): number {
  if (!reliability) return 0.35;
  const letter = reliability[0];
  const number = Number(reliability[1] ?? "3");
  const base = letter === "A" ? 0.95 : letter === "B" ? 0.78 : letter === "C" ? 0.62 : 0.45;
  const penalty = Number.isFinite(number) ? Math.max(0, number - 1) * 0.05 : 0.1;
  return Math.max(0.25, base - penalty);
}

function containsHangul(value: string): boolean {
  return /[가-힣]/.test(value);
}

function buildCharacterNgrams(value: string, size: number): string[] {
  const chars = Array.from(value);
  const ngrams: string[] = [];
  for (let index = 0; index <= chars.length - size; index += 1) {
    ngrams.push(chars.slice(index, index + size).join(""));
  }
  return ngrams;
}
