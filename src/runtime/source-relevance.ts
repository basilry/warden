import type { InvestigationPlan } from "./investigation-plan-schema.ts";
import type { KnowledgeUnit } from "../agent/types.ts";

export type SourceRelevanceAssessment = {
  unitId: string;
  score: number;
  matchedTerms: string[];
  reason: string;
};

export type SourceRelevanceFilterResult = {
  accepted: KnowledgeUnit[];
  rejected: KnowledgeUnit[];
  assessments: SourceRelevanceAssessment[];
  warnings: string[];
};

export function filterRelevantKnowledgeUnits(
  units: KnowledgeUnit[],
  options: {
    objective: string;
    investigationPlan?: InvestigationPlan;
    minimumScore?: number;
    now?: string;
  }
): SourceRelevanceFilterResult {
  const minimumScore = options.minimumScore ?? 0.28;
  const requiredTerms = buildRequiredTerms(options.objective, options.investigationPlan);
  const assessments = units.map((unit) =>
    assessSourceRelevance(unit, requiredTerms, {
      objective: options.objective,
      now: options.now
    })
  );
  const accepted = units.filter((unit) => {
    const assessment = assessments.find((item) => item.unitId === unit.id);
    return (assessment?.score ?? 0) >= minimumScore;
  });
  const rejected = units.filter((unit) => !accepted.some((acceptedUnit) => acceptedUnit.id === unit.id));

  return {
    accepted,
    rejected,
    assessments,
    warnings: buildWarnings(rejected, assessments, minimumScore)
  };
}

export function assessSourceRelevance(
  unit: KnowledgeUnit,
  requiredTerms: string[],
  options: { objective?: string; now?: string } = {}
): SourceRelevanceAssessment {
  const text = normalizeForMatch(
    [
      unit.sourceUri,
      unit.metadata?.title,
      unit.metadata?.summary,
      unit.metadata?.publisher,
      ...unit.tags,
      ...unit.claims.map((claim) => claim.text)
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
  );
  const matchedTerms = requiredTerms.filter((term) => text.includes(term));
  const requiredHits = Math.max(3, Math.min(requiredTerms.length, 8));
  const coverage = requiredTerms.length === 0 ? 0.35 : matchedTerms.length / requiredHits;
  const authorityBoost = authoritySourceBoost(unit);
  const recencyBoost = recencyScore(unit, options.now) * 0.06;
  const languageBoost = languageMatchScore(unit, options.objective) * 0.04;
  const score = clamp(coverage * 0.8 + authorityBoost + recencyBoost + languageBoost, 0, 1);
  return {
    unitId: unit.id,
    score,
    matchedTerms,
    reason:
      matchedTerms.length > 0
        ? `질문/조사계획 핵심어 ${matchedTerms.length}개 일치`
        : "질문/조사계획 핵심어와 직접 일치하지 않음"
  };
}

function recencyScore(unit: KnowledgeUnit, now: string | undefined): number {
  const sourceDate = readDateString(unit.metadata?.publishedAt) ?? unit.extractedAt;
  const timestamp = Date.parse(sourceDate);
  const nowTimestamp = Date.parse(now ?? new Date().toISOString());
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowTimestamp)) return 0;
  const ageDays = Math.max(0, (nowTimestamp - timestamp) / 86_400_000);
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.75;
  if (ageDays <= 180) return 0.45;
  if (ageDays <= 730) return 0.2;
  return 0;
}

function languageMatchScore(unit: KnowledgeUnit, objective: string | undefined): number {
  if (!objective) return 0;
  const objectiveHasHangul = /[가-힣]/.test(objective);
  const text = normalizeForMatch([
    unit.sourceUri,
    unit.metadata?.publisher,
    unit.metadata?.language,
    ...unit.tags
  ].filter((value): value is string => typeof value === "string").join(" "));
  if (objectiveHasHangul && /language:korean|kbs\.co\.kr|sbs\.co\.kr|imbc\.com|mbc\.co\.kr|jtbc\.co\.kr|yna\.co\.kr|go\.kr/.test(text)) {
    return 1;
  }
  if (!objectiveHasHangul && /language:english|reuters\.com|bbc\.co|cnn\.com|foxnews\.com|state\.gov|whitehouse\.gov|defense\.gov/.test(text)) {
    return 1;
  }
  return 0.25;
}

function readDateString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildRequiredTerms(objective: string, plan: InvestigationPlan | undefined): string[] {
  return uniqueNonEmpty([
    ...tokenizeMeaningfulTerms(objective),
    ...(plan?.classification.matchedSignals.flatMap(tokenizeMeaningfulTerms) ?? []),
    ...(plan?.hypotheses.flatMap((hypothesis) => [
      ...tokenizeMeaningfulTerms(hypothesis.statement),
      ...hypothesis.indicators.flatMap(tokenizeMeaningfulTerms)
    ]) ?? []),
    ...(plan?.searchPlan.flatMap((step) => [
      ...tokenizeMeaningfulTerms(step.query),
      ...step.tags.flatMap(tokenizeMeaningfulTerms)
    ]) ?? [])
  ]).slice(0, 80);
}

function tokenizeMeaningfulTerms(value: string): string[] {
  return uniqueNonEmpty(
    normalizeForMatch(value)
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  );
}

function authoritySourceBoost(unit: KnowledgeUnit): number {
  const haystack = normalizeForMatch([unit.sourceUri, unit.metadata?.publisher, ...unit.tags].filter(Boolean).join(" "));
  if (/state\.gov|whitehouse\.gov|defense\.gov|congress\.gov|reuters\.com|bbc\.co|cnn\.com|foxnews\.com/.test(haystack)) {
    return 0.1;
  }
  if (/kbs\.co\.kr|sbs\.co\.kr|imbc\.com|mbc\.co\.kr|jtbc\.co\.kr|yna\.co\.kr/.test(haystack)) {
    return 0.08;
  }
  return 0;
}

function buildWarnings(
  rejected: KnowledgeUnit[],
  assessments: SourceRelevanceAssessment[],
  minimumScore: number
): string[] {
  if (rejected.length === 0) return [];
  const rejectedIds = new Set(rejected.map((unit) => unit.id));
  const sample = assessments
    .filter((assessment) => rejectedIds.has(assessment.unitId))
    .slice(0, 3)
    .map((assessment) => `${assessment.unitId} relevance=${assessment.score.toFixed(2)} (${assessment.reason})`);
  return [
    `관련도 ${minimumScore.toFixed(2)} 미만 외부 자료 ${rejected.length}건은 ACH 판단 근거에서 제외했습니다.`,
    ...sample
  ];
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "about",
  "latest",
  "news",
  "response",
  "policy",
  "analysis",
  "reaction",
  "대한",
  "관련",
  "정책",
  "분석",
  "반응",
  "가능성",
  "강화",
  "성향",
  "내용",
  "알려줘"
]);
