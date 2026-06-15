import {
  classifySupplyChainQuestion,
  type DomainQuestionClassification
} from "../domain/question-classifier.ts";
import {
  buildSupplyChainKnowledgeUnits,
  findSupplyChainAnswerFrame,
  loadKoreaNortheastAsiaSupplyChainProfile,
  type SupplyChainAnswerFrame,
  type SupplyChainDomainProfile
} from "../domain/supply-chain-profile.ts";
import type { KnowledgeUnit } from "../types.ts";

export type RetrievalOptions = {
  limit?: number;
  minScore?: number;
  queryTags?: string[];
  requiredTags?: string[];
};

export type RetrievedKnowledgeUnit = {
  unit: KnowledgeUnit;
  score: number;
  matchedTerms: string[];
  matchedTags: string[];
  claimSnippets: string[];
};

export type RetrievalResult = {
  query: string;
  normalizedQuery: string;
  queryTags: string[];
  items: RetrievedKnowledgeUnit[];
  warnings: string[];
};

export type SupplyChainGroundingResult = {
  classification: DomainQuestionClassification;
  profile: SupplyChainDomainProfile;
  retrieval: RetrievalResult;
  answerFrame?: SupplyChainAnswerFrame;
};

const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SCORE = 0.12;
const STOPWORDS = new Set([
  "및",
  "에",
  "에 대해",
  "대해",
  "알려줘",
  "정리",
  "해주세요",
  "please",
  "about",
  "the",
  "and",
  "for"
]);

export function retrieveSupplyChainGrounding(
  question: string,
  options: RetrievalOptions = {}
): SupplyChainGroundingResult {
  const classification = classifySupplyChainQuestion(question);
  const profile = loadKoreaNortheastAsiaSupplyChainProfile();
  const units = buildSupplyChainKnowledgeUnits(profile);
  const retrieval = retrieveKnowledgeUnits(question, units, {
    limit: options.limit,
    minScore: options.minScore,
    requiredTags: options.requiredTags,
    queryTags: uniqueNonEmpty([...(options.queryTags ?? []), ...classification.retrievalTags])
  });
  const answerFrame = firstDefined(
    classification.intents.map((intent) => findSupplyChainAnswerFrame(profile, intent))
  );

  return {
    classification,
    profile,
    retrieval: classification.isSupplyChainQuestion
      ? retrieval
      : {
          ...retrieval,
          warnings: uniqueNonEmpty([
            ...retrieval.warnings,
            "질문이 공급망 도메인으로 분류되지 않아 P10 grounding 결과를 답변에 직접 사용하면 안 됩니다."
          ])
        },
    answerFrame
  };
}

export function retrieveKnowledgeUnits(
  query: string,
  units: KnowledgeUnit[],
  options: RetrievalOptions = {}
): RetrievalResult {
  const normalizedQuery = normalizeRetrievalText(query);
  const queryTags = uniqueNonEmpty(options.queryTags ?? []);
  const requiredTags = new Set(options.requiredTags ?? []);
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const scored = units
    .map((unit) => scoreKnowledgeUnitForQuery(unit, normalizedQuery, queryTags, requiredTags))
    .filter((item) => item.score >= minScore)
    .sort(compareRetrievedKnowledgeUnits)
    .slice(0, limit);

  return {
    query,
    normalizedQuery,
    queryTags,
    items: scored,
    warnings: buildRetrievalWarnings(query, units, scored, queryTags)
  };
}

export function scoreKnowledgeUnitForQuery(
  unit: KnowledgeUnit,
  normalizedQuery: string,
  queryTags: string[] = [],
  requiredTags = new Set<string>()
): RetrievedKnowledgeUnit {
  if (!hasRequiredTags(unit, requiredTags)) {
    return {
      unit,
      score: 0,
      matchedTerms: [],
      matchedTags: [],
      claimSnippets: buildClaimSnippets(unit)
    };
  }

  const unitText = buildRetrievalCorpusText(unit);
  const queryTokens = tokenizeRetrievalText(normalizedQuery);
  const unitTokens = tokenizeRetrievalText(unitText);
  const matchedTerms = [...queryTokens].filter((token) => unitTokens.has(token)).sort();
  const matchedTags = matchTags(unit.tags, queryTags);
  const termScore = queryTokens.size === 0 ? 0 : Math.min(1, matchedTerms.length / Math.max(4, queryTokens.size));
  const tagScore = queryTags.length === 0 ? 0 : Math.min(1, matchedTags.length / Math.max(2, queryTags.length));
  const reliabilityScore = reliabilityToScore(unit.reliability);
  const score = Number((termScore * 0.45 + tagScore * 0.45 + reliabilityScore * 0.1).toFixed(4));

  return {
    unit,
    score,
    matchedTerms,
    matchedTags,
    claimSnippets: buildClaimSnippets(unit)
  };
}

export function buildRetrievalCorpusText(unit: KnowledgeUnit): string {
  return [
    unit.id,
    unit.sourceUri,
    unit.reliability,
    ...unit.tags,
    ...unit.claims.map((claim) => claim.text)
  ].join(" ");
}

export function normalizeRetrievalText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/[:_/()[\]{}.,;!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeRetrievalText(value: string): Set<string> {
  const normalized = normalizeRetrievalText(value);
  const tokens = new Set<string>();
  for (const part of normalized.split(" ")) {
    const token = part.trim();
    if (!token || STOPWORDS.has(token)) continue;
    tokens.add(token);
    if (containsHangul(token)) {
      for (const ngram of buildCharacterNgrams(token, 2)) tokens.add(ngram);
    }
  }
  return tokens;
}

export function renderRetrievalSummary(result: RetrievalResult): string {
  if (result.items.length === 0) {
    return `검색 결과 없음: ${result.query}`;
  }
  return result.items
    .map((item, index) => {
      const claim = item.claimSnippets[0] ?? "(no claim)";
      const tags = item.matchedTags.length > 0 ? ` tags=${item.matchedTags.join(",")}` : "";
      return `${index + 1}. ${item.unit.id} score=${item.score.toFixed(2)}${tags} :: ${claim}`;
    })
    .join("\n");
}

function hasRequiredTags(unit: KnowledgeUnit, requiredTags: Set<string>): boolean {
  if (requiredTags.size === 0) return true;
  return [...requiredTags].every((tag) => unit.tags.includes(tag));
}

function matchTags(unitTags: string[], queryTags: string[]): string[] {
  const queryTagSet = new Set(queryTags);
  return unitTags.filter((tag) => queryTagSet.has(tag)).sort();
}

function buildClaimSnippets(unit: KnowledgeUnit): string[] {
  return unit.claims.map((claim) => claim.text).filter((text) => text.trim().length > 0);
}

function reliabilityToScore(reliability: string | undefined): number {
  if (!reliability) return 0.35;
  const letter = reliability[0];
  const number = Number(reliability[1] ?? "3");
  const base = letter === "A" ? 0.95 : letter === "B" ? 0.78 : letter === "C" ? 0.62 : 0.45;
  const penalty = Number.isFinite(number) ? Math.max(0, number - 1) * 0.05 : 0.1;
  return Math.max(0.25, base - penalty);
}

function compareRetrievedKnowledgeUnits(left: RetrievedKnowledgeUnit, right: RetrievedKnowledgeUnit): number {
  if (right.score !== left.score) return right.score - left.score;
  const reliabilityDiff = reliabilityToScore(right.unit.reliability) - reliabilityToScore(left.unit.reliability);
  if (reliabilityDiff !== 0) return reliabilityDiff;
  return left.unit.id.localeCompare(right.unit.id);
}

function buildRetrievalWarnings(
  query: string,
  units: KnowledgeUnit[],
  items: RetrievedKnowledgeUnit[],
  queryTags: string[]
): string[] {
  const warnings: string[] = [];
  if (query.trim().length === 0) warnings.push("검색 질문이 비어 있습니다.");
  if (units.length === 0) warnings.push("검색할 KnowledgeUnit이 없습니다.");
  if (queryTags.length === 0) warnings.push("분류 기반 queryTags가 없어 lexical score만 사용했습니다.");
  if (items.length === 0) warnings.push("minScore를 넘는 KnowledgeUnit이 없습니다.");
  return warnings;
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

function firstDefined<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
