import type { CaseFrame } from "./types.ts";

export type InvestigationPlanLike = {
  question?: unknown;
  researchQuestion?: unknown;
  objective?: unknown;
  userRequest?: unknown;
  title?: unknown;
  summary?: unknown;
  domain?: unknown;
  hypotheses?: unknown;
  competingHypotheses?: unknown;
  candidateHypotheses?: unknown;
  alternatives?: unknown;
  hypothesisSet?: unknown;
  achHypotheses?: unknown;
  nullHypothesis?: unknown;
  baselineHypothesis?: unknown;
  defaultHypothesis?: unknown;
  statusQuoHypothesis?: unknown;
  caseFrame?: unknown;
};

export type DynamicCaseFrameOptions = {
  fallbackQuestion?: string;
  fallbackNullHypothesis?: string;
  fallbackDomain?: CaseFrame["domain"];
};

const QUESTION_KEYS = ["question", "researchQuestion", "objective", "userRequest", "title", "summary"] as const;
const HYPOTHESIS_ARRAY_KEYS = [
  "hypotheses",
  "competingHypotheses",
  "candidateHypotheses",
  "alternatives",
  "achHypotheses"
] as const;
const NULL_HYPOTHESIS_KEYS = [
  "nullHypothesis",
  "baselineHypothesis",
  "defaultHypothesis",
  "statusQuoHypothesis"
] as const;

const DEFAULT_QUESTION = "동적 조사 계획의 핵심 설명 가설은 무엇인가?";
const DEFAULT_NULL_HYPOTHESIS = "관측은 핵심 사건 변화가 아니라 정상 변동 또는 자료 공백으로 설명된다.";
const DEFAULT_DOMAIN = "defense_supply_chain" as CaseFrame["domain"];

export function caseFrameFromInvestigationPlan(
  input: unknown,
  options: DynamicCaseFrameOptions = {}
): CaseFrame | undefined {
  if (!isRecord(input)) return undefined;
  try {
    return buildDynamicCaseFrame(input, options);
  } catch {
    return undefined;
  }
}

export function requireCaseFrameFromInvestigationPlan(
  input: unknown,
  options: DynamicCaseFrameOptions = {}
): CaseFrame {
  const frame = caseFrameFromInvestigationPlan(input, options);
  if (!frame) {
    throw new Error("A valid InvestigationPlan-like object is required to build a dynamic CaseFrame.");
  }
  return frame;
}

export function buildDynamicCaseFrame(
  plan: InvestigationPlanLike,
  options: DynamicCaseFrameOptions = {}
): CaseFrame {
  const caseFrame = isRecord(plan.caseFrame) ? plan.caseFrame : undefined;
  const question =
    firstStringFromKeys(caseFrame, QUESTION_KEYS) ??
    firstStringFromKeys(plan, QUESTION_KEYS) ??
    options.fallbackQuestion ??
    DEFAULT_QUESTION;

  const extracted = extractHypotheses(plan, caseFrame);
  const nullHypothesis =
    firstStringFromKeys(caseFrame, NULL_HYPOTHESIS_KEYS) ??
    firstStringFromKeys(plan, NULL_HYPOTHESIS_KEYS) ??
    extracted.nullHypothesis ??
    options.fallbackNullHypothesis ??
    DEFAULT_NULL_HYPOTHESIS;
  const hypotheses = dedupeStrings(extracted.hypotheses).filter((hypothesis) => hypothesis !== nullHypothesis);

  if (hypotheses.length < 2) {
    throw new Error("Dynamic CaseFrame requires at least two non-null competing hypotheses.");
  }

  return {
    question,
    hypotheses,
    nullHypothesis,
    domain: extractDomain(caseFrame, plan, options.fallbackDomain)
  };
}

function extractDomain(
  caseFrame: Record<string, unknown> | undefined,
  plan: InvestigationPlanLike,
  fallback: CaseFrame["domain"] | undefined
): CaseFrame["domain"] {
  if (isCaseFrameDomain(caseFrame?.domain)) return caseFrame.domain;
  if (isCaseFrameDomain(plan.domain)) return plan.domain;
  return fallback ?? DEFAULT_DOMAIN;
}

function extractHypotheses(
  plan: InvestigationPlanLike,
  caseFrame: Record<string, unknown> | undefined
): { hypotheses: string[]; nullHypothesis?: string } {
  const hypotheses: string[] = [];
  const nullHypotheses: string[] = [];

  for (const source of [caseFrame, plan, isRecord(plan.hypothesisSet) ? plan.hypothesisSet : undefined]) {
    if (!source) continue;
    for (const key of HYPOTHESIS_ARRAY_KEYS) {
      for (const item of readHypothesisItems(source[key])) {
        const parsed = parseHypothesisItem(item);
        if (!parsed) continue;
        if (parsed.isNull) {
          nullHypotheses.push(parsed.text);
        } else {
          hypotheses.push(parsed.text);
        }
      }
    }
  }

  return {
    hypotheses,
    nullHypothesis: dedupeStrings(nullHypotheses)[0]
  };
}

function parseHypothesisItem(item: unknown): { text: string; isNull: boolean } | undefined {
  if (typeof item === "string") {
    const text = normalizeText(item);
    return text ? { text, isNull: false } : undefined;
  }
  if (!isRecord(item)) return undefined;

  const text = firstStringFromKeys(item, ["text", "hypothesis", "statement", "claim", "label", "title", "name", "description"]);
  if (!text) return undefined;

  const role = firstStringFromKeys(item, ["role", "type", "kind", "category"])?.toLowerCase() ?? "";
  const label = firstStringFromKeys(item, ["id", "label", "name"])?.toLowerCase() ?? "";
  return {
    text,
    isNull: item.isNull === true || item.null === true || role === "null" || role === "baseline" || label === "null"
  };
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

function firstStringFromKeys<T extends readonly string[]>(
  value: Record<string, unknown> | undefined,
  keys: T
): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const text = normalizeText(value[key]);
    if (text) return text;
  }
  return undefined;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : undefined;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function isCaseFrameDomain(value: unknown): value is CaseFrame["domain"] {
  return (
    value === "defense_supply_chain" ||
    value === "security" ||
    value === "geopolitics" ||
    value === "supply_chain" ||
    value === "defense" ||
    value === "economic_security" ||
    value === "mixed"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
