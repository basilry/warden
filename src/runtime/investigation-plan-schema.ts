export const INVESTIGATION_PLAN_SCHEMA_VERSION = "p19.investigation-plan.v1";

export const INVESTIGATION_DOMAINS = [
  "security",
  "geopolitics",
  "supply_chain",
  "defense",
  "economic_security",
  "mixed"
] as const;

export const INVESTIGATION_PRIORITIES = ["high", "medium", "low"] as const;

export type InvestigationDomain = (typeof INVESTIGATION_DOMAINS)[number];
export type InvestigationPriority = (typeof INVESTIGATION_PRIORITIES)[number];
export type InvestigationPlanSource = "model_proposal" | "deterministic_fallback";

export type InvestigationScenario =
  | "taiwan_invasion"
  | "korea_northeast_asia_supply_chain"
  | "sanctions_export_controls"
  | "us_alliance_response"
  | "claim_verification"
  | "generic_security";

export type InvestigationClassification = {
  scenario: InvestigationScenario;
  domain: InvestigationDomain;
  confidence: number;
  matchedSignals: string[];
};

export type InvestigationHypothesis = {
  id: string;
  label: string;
  statement: string;
  rationale: string;
  priority: InvestigationPriority;
  domain: InvestigationDomain;
  indicators: string[];
  disconfirmingSignals: string[];
  disconfirmingIndicators: string[];
};

export type InvestigationSearchStep = {
  id: string;
  query: string;
  purpose: string;
  sourceTypes: string[];
  tags: string[];
};

export type InvestigationPlan = {
  schemaVersion: typeof INVESTIGATION_PLAN_SCHEMA_VERSION;
  objective: string;
  title: string;
  domain: InvestigationDomain;
  classification: InvestigationClassification;
  hypotheses: InvestigationHypothesis[];
  searchPlan: InvestigationSearchStep[];
  source: InvestigationPlanSource;
  warnings: string[];
};

export type InvestigationPlanParseResult = {
  proposal?: unknown;
  warnings: string[];
};

export type InvestigationPlanValidationReport = {
  status: "pass" | "fail";
  errors: string[];
  warnings: string[];
};

const VALID_DOMAINS = new Set<string>(INVESTIGATION_DOMAINS);
const VALID_PRIORITIES = new Set<string>(INVESTIGATION_PRIORITIES);

export function parseInvestigationPlanProposal(output: unknown): InvestigationPlanParseResult {
  if (typeof output === "string") {
    const parsed = parseJsonObject(output);
    if (!parsed.ok) {
      return { warnings: [`model proposal is not valid JSON: ${parsed.error}`] };
    }
    if (!isRecord(parsed.value)) {
      return { warnings: ["model proposal JSON must be an object."] };
    }
    return { proposal: parsed.value, warnings: [] };
  }

  if (!isRecord(output)) {
    return { warnings: ["model proposal must be an object or JSON object string."] };
  }

  return { proposal: output, warnings: [] };
}

export function validateInvestigationPlanProposal(
  proposal: unknown,
  options: { objective?: string } = {}
): InvestigationPlanValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(proposal)) {
    return {
      status: "fail",
      errors: ["plan must be an object."],
      warnings
    };
  }

  if (proposal.schemaVersion !== INVESTIGATION_PLAN_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must be "${INVESTIGATION_PLAN_SCHEMA_VERSION}", got ${formatUnknown(proposal.schemaVersion)}.`
    );
  }

  const objective = readString(proposal.objective);
  if (!objective) {
    errors.push("objective must be a non-empty string.");
  } else if (options.objective && normalizeForCompare(objective) !== normalizeForCompare(options.objective)) {
    warnings.push("proposal objective differs from requested objective; builder will preserve the requested objective.");
  }

  if (!readString(proposal.title)) {
    errors.push("title must be a non-empty string.");
  }

  if (!isInvestigationDomain(proposal.domain)) {
    errors.push(`domain must be one of ${INVESTIGATION_DOMAINS.join(", ")}, got ${formatUnknown(proposal.domain)}.`);
  }

  validateClassification(proposal.classification, warnings);
  validateHypotheses(proposal.hypotheses, errors);
  validateSearchPlan(proposal.searchPlan, errors);

  if ("source" in proposal && !isPlanSource(proposal.source)) {
    warnings.push(`source is ignored unless it is model_proposal or deterministic_fallback, got ${formatUnknown(proposal.source)}.`);
  }
  if ("warnings" in proposal && !isStringArray(proposal.warnings)) {
    warnings.push("warnings must be a string array when provided; model warnings will be ignored.");
  }

  return {
    status: errors.length > 0 ? "fail" : "pass",
    errors,
    warnings
  };
}

export function validateInvestigationPlan(
  plan: unknown,
  options: { objective?: string } = {}
): InvestigationPlanValidationReport {
  return validateInvestigationPlanProposal(plan, options);
}

export function isInvestigationPlan(value: unknown): value is InvestigationPlan {
  return validateInvestigationPlanProposal(value).status === "pass";
}

export function isInvestigationDomain(value: unknown): value is InvestigationDomain {
  return typeof value === "string" && VALID_DOMAINS.has(value);
}

export function isInvestigationPriority(value: unknown): value is InvestigationPriority {
  return typeof value === "string" && VALID_PRIORITIES.has(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueNonEmpty(value.map((item) => (typeof item === "string" ? item : undefined)));
}

export function uniqueNonEmpty(values: Array<string | undefined>): string[] {
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

function validateClassification(value: unknown, warnings: string[]): void {
  if (!isRecord(value)) {
    warnings.push("classification is missing or invalid; builder may attach deterministic classification metadata.");
    return;
  }

  if (!isInvestigationScenario(value.scenario)) {
    warnings.push(`classification.scenario is not recognized, got ${formatUnknown(value.scenario)}.`);
  }
  if (!isInvestigationDomain(value.domain)) {
    warnings.push(`classification.domain is invalid, got ${formatUnknown(value.domain)}.`);
  }
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    warnings.push("classification.confidence must be a number from 0 to 1 when provided.");
  }
  if (!isStringArray(value.matchedSignals)) {
    warnings.push("classification.matchedSignals must be a string array when provided.");
  }
}

function validateHypotheses(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("hypotheses must be an array.");
    return;
  }
  if (value.length < 3) {
    errors.push(`hypotheses must contain at least 3 competing hypotheses, got ${value.length}.`);
  }

  const ids = new Set<string>();
  value.forEach((item, index) => {
    const prefix = `hypotheses[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }
    const id = readString(item.id);
    if (!id) {
      errors.push(`${prefix}.id must be a non-empty string.`);
    } else if (ids.has(id)) {
      errors.push(`${prefix}.id duplicates "${id}".`);
    } else {
      ids.add(id);
    }
    if (!readString(item.label)) errors.push(`${prefix}.label must be a non-empty string.`);
    if (!readString(item.statement)) errors.push(`${prefix}.statement must be a non-empty string.`);
    if (!readString(item.rationale)) errors.push(`${prefix}.rationale must be a non-empty string.`);
    if (!isInvestigationPriority(item.priority)) {
      errors.push(`${prefix}.priority must be one of ${INVESTIGATION_PRIORITIES.join(", ")}.`);
    }
    if (!isInvestigationDomain(item.domain)) {
      errors.push(`${prefix}.domain must be one of ${INVESTIGATION_DOMAINS.join(", ")}.`);
    }
    if (!isStringArray(item.indicators) || item.indicators.length === 0) {
      errors.push(`${prefix}.indicators must be a non-empty string array.`);
    }
    if (!isStringArray(item.disconfirmingSignals) || item.disconfirmingSignals.length === 0) {
      errors.push(`${prefix}.disconfirmingSignals must be a non-empty string array.`);
    }
    if (!isStringArray(item.disconfirmingIndicators) || item.disconfirmingIndicators.length === 0) {
      errors.push(`${prefix}.disconfirmingIndicators must be a non-empty string array.`);
    }
  });
}

function validateSearchPlan(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("searchPlan must be an array.");
    return;
  }
  if (value.length < 3) {
    errors.push(`searchPlan must contain at least 3 search steps, got ${value.length}.`);
  }

  const ids = new Set<string>();
  value.forEach((item, index) => {
    const prefix = `searchPlan[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }
    const id = readString(item.id);
    if (!id) {
      errors.push(`${prefix}.id must be a non-empty string.`);
    } else if (ids.has(id)) {
      errors.push(`${prefix}.id duplicates "${id}".`);
    } else {
      ids.add(id);
    }
    if (!readString(item.query)) errors.push(`${prefix}.query must be a non-empty string.`);
    if (!readString(item.purpose)) errors.push(`${prefix}.purpose must be a non-empty string.`);
    if (!isStringArray(item.sourceTypes) || item.sourceTypes.length === 0) {
      errors.push(`${prefix}.sourceTypes must be a non-empty string array.`);
    }
    if (!isStringArray(item.tags) || item.tags.length === 0) {
      errors.push(`${prefix}.tags must be a non-empty string array.`);
    }
  });
}

function parseJsonObject(value: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isInvestigationScenario(value: unknown): value is InvestigationScenario {
  return (
    value === "taiwan_invasion" ||
    value === "korea_northeast_asia_supply_chain" ||
    value === "sanctions_export_controls" ||
    value === "us_alliance_response" ||
    value === "claim_verification" ||
    value === "generic_security"
  );
}

function isPlanSource(value: unknown): value is InvestigationPlanSource {
  return value === "model_proposal" || value === "deterministic_fallback";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function normalizeForCompare(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}
