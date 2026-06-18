import { hashPayload } from "./ids.ts";
import type { CaseFrame, EvidenceBundle, KnowledgeUnit, Verdict } from "./types.ts";

export type DynamicEvidenceMappingOptions = {
  investigationPlan?: unknown;
  reliabilityFallback?: string;
  assumptions?: string[];
  unverifiedAreas?: string[];
  assumption?: string;
  unverifiedArea?: string;
  includeTagsInScoring?: boolean;
};

type HypothesisEvidenceHints = {
  label: string;
  indicators: string[];
  disconfirmingIndicators: string[];
};

type RuleSet = {
  triggers: string[];
  indicators: string[];
};

const DEFAULT_ASSUMPTIONS = [
  "KnowledgeUnit claims were mapped into ACH evidence through deterministic dynamic scoring.",
  "The verdict mapping is conservative and should be reviewed by an analyst for operational use."
];
const DEFAULT_UNVERIFIED_AREAS = ["Dynamic evidence-to-hypothesis mapping has not been analyst-confirmed."];

const RULE_SETS: RuleSet[] = [
  {
    triggers: ["invasion", "invade", "침공", "상륙", "강습"],
    indicators: ["invasion", "invade", "landing", "amphibious", "mobilization", "침공", "상륙", "강습", "동원", "집결"]
  },
  {
    triggers: ["blockade", "quarantine", "봉쇄", "차단"],
    indicators: ["blockade", "quarantine", "cordon", "inspection", "봉쇄", "차단", "검문", "항행", "통항"]
  },
  {
    triggers: ["exercise", "drill", "훈련", "연습"],
    indicators: ["exercise", "drill", "routine", "scheduled", "훈련", "연습", "정례", "통상", "예정"]
  },
  {
    triggers: ["information", "influence", "disinformation", "정보작전", "여론", "선전"],
    indicators: ["disinformation", "propaganda", "influence", "narrative", "정보작전", "허위", "선전", "여론", "서사"]
  },
  {
    triggers: ["diplomatic", "negotiation", "외교", "협상"],
    indicators: ["diplomatic", "negotiation", "talks", "envoy", "외교", "협상", "특사", "회담", "성명"]
  },
  {
    triggers: ["cyber", "사이버", "해킹"],
    indicators: ["cyber", "malware", "intrusion", "outage", "사이버", "해킹", "침해", "장애"]
  },
  {
    triggers: ["miscalculation", "accident", "오판", "우발"],
    indicators: ["miscalculation", "accident", "incident", "collision", "오판", "우발", "사고", "충돌"]
  }
];

const ROUTINE_TERMS = ["routine", "scheduled", "normal", "regular", "통상", "정례", "예정", "정상", "반복"];
const ESCALATION_TERMS = [
  "alert",
  "surge",
  "mobilization",
  "emergency",
  "warning",
  "unusual",
  "escalation",
  "급증",
  "고조",
  "집결",
  "동원",
  "경보",
  "비상",
  "이례",
  "확대",
  "침공",
  "봉쇄"
];
const NEGATION_TERMS = [
  "no evidence",
  "not observed",
  "denied",
  "unlikely",
  "없다",
  "확인되지",
  "부인",
  "아니다",
  "가능성 낮",
  "미확인"
];
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
  "that",
  "this",
  "into",
  "from",
  "about",
  "hypothesis",
  "가설",
  "현재",
  "가능성",
  "시나리오",
  "분석",
  "관련",
  "확인",
  "위험",
  "리스크",
  "설명",
  "관측",
  "자료",
  "공백"
]);
const HYPOTHESIS_HINT_KEYS = [
  "hypotheses",
  "competingHypotheses",
  "candidateHypotheses",
  "alternatives",
  "achHypotheses"
] as const;

export function mapKnowledgeUnitsToEvidenceBundles(
  units: KnowledgeUnit[],
  frame: CaseFrame,
  options: DynamicEvidenceMappingOptions = {}
): EvidenceBundle[] {
  const hints = parseHypothesisHints(options.investigationPlan);
  return units.map((unit, index) => {
    const text = renderKnowledgeUnitText(unit);
    const scoringText = options.includeTagsInScoring === false ? text : `${text} ${unit.tags.join(" ")}`;
    return {
      id: `eb_dynamic_${hashPayload({ unitId: unit.id, frame, text, index }).slice(0, 12)}`,
      knowledgeUnitId: unit.id,
      text,
      source: unit.provenance.originalLocation ?? unit.sourceUri,
      reliability: normalizeReliability(unit.reliability, options.reliabilityFallback),
      verdicts: scoreEvidenceTextAgainstFrame(scoringText, frame, hints),
      assumptions: options.assumptions ?? buildAssumptions(options.assumption),
      unverifiedAreas: options.unverifiedAreas ?? buildUnverifiedAreas(options.unverifiedArea)
    };
  });
}

export const buildEvidenceBundlesForCaseFrame = mapKnowledgeUnitsToEvidenceBundles;
export const knowledgeUnitsToEvidenceBundles = mapKnowledgeUnitsToEvidenceBundles;

export function scoreEvidenceTextAgainstFrame(
  text: string,
  frame: CaseFrame,
  investigationPlan?: unknown
): Record<string, Verdict> {
  const hints = Array.isArray(investigationPlan)
    ? (investigationPlan as HypothesisEvidenceHints[])
    : parseHypothesisHints(investigationPlan);
  const nullContradictionTerms = collectNonNullIndicators(frame, hints);
  const verdicts: Record<string, Verdict> = {};

  for (const hypothesis of frame.hypotheses) {
    verdicts[hypothesis] = scoreEvidenceAgainstHypothesis(text, hypothesis, {
      hints: findHints(hints, hypothesis)
    });
  }
  verdicts[frame.nullHypothesis] = scoreEvidenceAgainstHypothesis(text, frame.nullHypothesis, {
    isNullHypothesis: true,
    contradictionTerms: nullContradictionTerms
  });
  return verdicts;
}

export const scoreEvidenceAgainstCaseFrame = scoreEvidenceTextAgainstFrame;

export function scoreEvidenceAgainstHypothesis(
  text: string,
  hypothesis: string,
  options: {
    isNullHypothesis?: boolean;
    hints?: HypothesisEvidenceHints;
    contradictionTerms?: string[];
  } = {}
): Verdict {
  const evidence = normalizeForMatch(text);
  const hypothesisTerms = tokenizeMeaningfulTerms(hypothesis);
  const indicatorTerms = deriveIndicators(hypothesis, options.hints?.indicators ?? []);
  const disconfirmingTerms = expandTerms(options.hints?.disconfirmingIndicators ?? options.contradictionTerms ?? []);
  const directOverlap = countMatches(evidence, hypothesisTerms);
  const support = countMatches(evidence, indicatorTerms);
  const contradiction = countMatches(evidence, disconfirmingTerms);
  const hasNegation = containsAny(evidence, NEGATION_TERMS);

  if (contradiction > support && contradiction > 0) return "I";
  if (hasNegation && (directOverlap > 0 || support > 0)) return "I";

  if (options.isNullHypothesis || looksLikeNullHypothesis(hypothesis)) {
    if (support > 0 && !containsAny(evidence, ESCALATION_TERMS)) return "C";
    if (containsAny(evidence, ESCALATION_TERMS) || contradiction > 0) return "I";
    return directOverlap >= 2 ? "C" : "N";
  }

  if (support >= 2 || (support >= 1 && directOverlap >= 1) || directOverlap >= 2) return "C";
  return "N";
}

function renderKnowledgeUnitText(unit: KnowledgeUnit): string {
  const claims = unit.claims.map((claim) => claim.text.trim()).filter((text) => text.length > 0);
  return claims.length > 0 ? claims.join(" ") : unit.sourceUri;
}

function parseHypothesisHints(plan: unknown): HypothesisEvidenceHints[] {
  const candidate = isRecord(plan) && isRecord(plan.plan) ? plan.plan : plan;
  if (!isRecord(candidate)) return [];
  const sources = [candidate, isRecord(candidate.hypothesisSet) ? candidate.hypothesisSet : undefined];
  const hints: HypothesisEvidenceHints[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const key of HYPOTHESIS_HINT_KEYS) {
      hints.push(
        ...readHypothesisItems(source[key])
          .map(parseHypothesisHint)
          .filter((hint): hint is HypothesisEvidenceHints => Boolean(hint))
      );
    }
  }
  return dedupeHints(hints);
}

function parseHypothesisHint(item: unknown): HypothesisEvidenceHints | undefined {
  if (!isRecord(item)) return undefined;
  const label = firstStringFromKeys(item, ["text", "hypothesis", "statement", "claim", "label", "title", "name"]);
  if (!label) return undefined;
  return {
    label,
    indicators: parseStringArray(item.indicators),
    disconfirmingIndicators: parseStringArray(item.disconfirmingIndicators)
  };
}

function collectNonNullIndicators(frame: CaseFrame, hints: HypothesisEvidenceHints[]): string[] {
  return frame.hypotheses.flatMap((hypothesis) => [
    ...deriveIndicators(hypothesis, findHints(hints, hypothesis)?.indicators ?? []),
    ...tokenizeMeaningfulTerms(hypothesis)
  ]);
}

function findHints(hints: HypothesisEvidenceHints[], hypothesis: string): HypothesisEvidenceHints | undefined {
  const normalized = normalizeForMatch(hypothesis);
  return hints.find((hint) => normalizeForMatch(hint.label) === normalized);
}

function deriveIndicators(hypothesis: string, planIndicators: string[] = []): string[] {
  const normalized = normalizeForMatch(hypothesis);
  const indicators = new Set<string>([...tokenizeMeaningfulTerms(hypothesis), ...expandTerms(planIndicators)]);
  for (const ruleSet of RULE_SETS) {
    if (containsAny(normalized, ruleSet.triggers)) {
      for (const indicator of ruleSet.indicators) indicators.add(normalizeTerm(indicator));
    }
  }
  return [...indicators].filter((term) => term.length > 0);
}

function expandTerms(values: string[]): string[] {
  return dedupe(values.flatMap((value) => [normalizeForMatch(value), ...tokenizeMeaningfulTerms(value)]));
}

function tokenizeMeaningfulTerms(value: string): string[] {
  return dedupe(
    normalizeForMatch(value)
      .split(/[^\p{L}\p{N}]+/u)
      .map(normalizeTerm)
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  );
}

function normalizeTerm(value: string): string {
  return normalizeForMatch(value)
    .replace(/(은|는|이|가|을|를|으로|로|에서|에게|와|과|의|도|만|부터|까지)$/u, "")
    .replace(/(한다|했다|된다|됐다|이다|준비한다)$/u, "")
    .trim();
}

function countMatches(text: string, terms: string[]): number {
  let count = 0;
  const seen = new Set<string>();
  for (const term of terms) {
    const normalized = normalizeForMatch(term);
    if (normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    if (text.includes(normalized)) count += 1;
  }
  return count;
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalizeForMatch(term)));
}

function looksLikeNullHypothesis(hypothesis: string): boolean {
  const normalized = normalizeForMatch(hypothesis);
  return containsAny(normalized, ["null", "baseline", "status quo", "영가설", "기저", "정상", "자료 공백"]);
}

function buildAssumptions(assumption: string | undefined): string[] {
  if (!assumption) return DEFAULT_ASSUMPTIONS;
  return [assumption, DEFAULT_ASSUMPTIONS[1]];
}

function buildUnverifiedAreas(unverifiedArea: string | undefined): string[] {
  return [unverifiedArea ?? DEFAULT_UNVERIFIED_AREAS[0]];
}

function normalizeReliability(reliability: string | undefined, fallback = "C3"): string {
  if (/^[A-F][1-6]$/.test(reliability ?? "")) return reliability!;
  return /^[A-F][1-6]$/.test(fallback) ? fallback : "C3";
}

function readHypothesisItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["items", "entries", "candidates", "hypotheses"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function firstStringFromKeys(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return undefined;
}

function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeHints(values: HypothesisEvidenceHints[]): HypothesisEvidenceHints[] {
  const seen = new Set<string>();
  const result: HypothesisEvidenceHints[] = [];
  for (const value of values) {
    const key = normalizeForMatch(value.label);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
