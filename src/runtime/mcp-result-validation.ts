export type McpResultValidationFamily = "osint" | "rag" | "ach" | "forecast" | "generic";

export type McpResultValidationContext = {
  toolName?: string;
  family?: McpResultValidationFamily;
};

export type McpResultValidationIssue = {
  path: string;
  message: string;
};

export type McpResultValidation =
  | { ok: true }
  | {
      ok: false;
      message: string;
      issues: McpResultValidationIssue[];
    };

export type McpResultValidator<T = unknown> = (
  value: T,
  context?: McpResultValidationContext
) => McpResultValidation;

const OK: McpResultValidation = { ok: true };
const MCP_RESULT_STATUSES = ["succeeded", "blocked", "failed"] as const;
const CONNECTOR_STATUSES = ["succeeded", "blocked"] as const;

export function validateMcpToolResultEnvelope(value: unknown, label = "MCP result"): McpResultValidation {
  const issues: McpResultValidationIssue[] = [];

  if (!isRecord(value)) {
    return invalid([{ path: "$", message: `${label} must be an object.` }]);
  }

  if (!isOneOf(value.status, MCP_RESULT_STATUSES)) {
    issues.push({
      path: "$.status",
      message: `${label} status must be one of ${MCP_RESULT_STATUSES.join(", ")}.`
    });
  }

  if (value.observationTrusted !== false) {
    issues.push({
      path: "$.observationTrusted",
      message: `${label} must explicitly mark MCP observations as untrusted.`
    });
  }

  if (value.status === "succeeded" && !hasOwn(value, "output")) {
    issues.push({
      path: "$.output",
      message: `${label} with status=succeeded must include output.`
    });
  }

  if ((value.status === "blocked" || value.status === "failed") && !isNonEmptyString(value.error)) {
    issues.push({
      path: "$.error",
      message: `${label} with status=${String(value.status)} must include a non-empty error string.`
    });
  }

  if (hasOwn(value, "error") && value.error !== undefined && typeof value.error !== "string") {
    issues.push({ path: "$.error", message: `${label} error must be a string when present.` });
  }

  return issues.length === 0 ? OK : invalid(issues);
}

export function validateOsintMcpResultEnvelope(
  value: unknown,
  _context: McpResultValidationContext = {}
): McpResultValidation {
  const issues: McpResultValidationIssue[] = [];
  const output = requireRecord(value, "$", "OSINT MCP output", issues);
  const result = output ? requireRecord(output.result, "$.result", "OSINT result", issues) : undefined;
  if (!result) return invalid(issues);

  validateStatusWarningsEnvelope(result, "$.result", CONNECTOR_STATUSES, issues);
  validateKnowledgeUnitArray(result.units, "$.result.units", issues);
  validateArtifactArray(result.artifacts, "$.result.artifacts", issues);

  if (hasOwn(result, "blockedReason") && result.blockedReason !== undefined && typeof result.blockedReason !== "string") {
    issues.push({ path: "$.result.blockedReason", message: "OSINT blockedReason must be a string when present." });
  }
  if (hasOwn(result, "sourceVetRequired") && result.sourceVetRequired !== true) {
    issues.push({ path: "$.result.sourceVetRequired", message: "OSINT sourceVetRequired must be true when present." });
  }
  if (hasOwn(result, "promoteToAch") && result.promoteToAch !== false) {
    issues.push({ path: "$.result.promoteToAch", message: "OSINT promoteToAch must be false when present." });
  }
  if (hasOwn(result, "documents") && !Array.isArray(result.documents)) {
    issues.push({ path: "$.result.documents", message: "OSINT documents must be an array when present." });
  }
  if (hasOwn(result, "discoveredUrls")) validateStringArray(result.discoveredUrls, "$.result.discoveredUrls", issues);
  if (hasOwn(result, "scrapedUrls")) validateStringArray(result.scrapedUrls, "$.result.scrapedUrls", issues);
  if (hasOwn(result, "providerWarnings") && result.providerWarnings !== undefined && !Array.isArray(result.providerWarnings)) {
    issues.push({ path: "$.result.providerWarnings", message: "OSINT providerWarnings must be an array when present." });
  }
  if (hasOwn(result, "providerTelemetry") && result.providerTelemetry !== undefined && !Array.isArray(result.providerTelemetry)) {
    issues.push({ path: "$.result.providerTelemetry", message: "OSINT providerTelemetry must be an array when present." });
  }

  return issues.length === 0 ? OK : invalid(issues);
}

export function validateRagMcpResultEnvelope(
  value: unknown,
  context: McpResultValidationContext = {}
): McpResultValidation {
  const issues: McpResultValidationIssue[] = [];
  const output = requireRecord(value, "$", "RAG MCP output", issues);
  if (!output) return invalid(issues);

  if (context.toolName === "summarize_corpus" || hasOwn(output, "summary")) {
    validateRagSummary(output.summary, "$.summary", issues);
  } else {
    const result = requireRecord(output.result, "$.result", "RAG retrieval result", issues);
    if (result) {
      if (!isNonEmptyString(result.query)) {
        issues.push({ path: "$.result.query", message: "RAG retrieval query must be a non-empty string." });
      }
      if (hasOwn(result, "normalizedQuery") && typeof result.normalizedQuery !== "string") {
        issues.push({ path: "$.result.normalizedQuery", message: "RAG normalizedQuery must be a string when present." });
      }
      validateKnowledgeUnitArray(result.units, "$.result.units", issues);
      validateStringArray(result.warnings, "$.result.warnings", issues);
      if (hasOwn(result, "items") && !Array.isArray(result.items)) {
        issues.push({ path: "$.result.items", message: "RAG retrieval items must be an array when present." });
      }
    }
    validateKnowledgeUnitArray(output.units, "$.units", issues);
  }

  return issues.length === 0 ? OK : invalid(issues);
}

export function validateAchMcpResultEnvelope(
  value: unknown,
  context: McpResultValidationContext = {}
): McpResultValidation {
  const issues: McpResultValidationIssue[] = [];
  const output = requireRecord(value, "$", "ACH MCP output", issues);
  if (!output) return invalid(issues);

  if (context.toolName === "rank_hypotheses" || hasOwn(output, "result")) {
    validateAchAnalysisResult(output.result, "$.result", issues);
  } else if (hasOwn(output, "caseRecord")) {
    validateAchCaseRecord(output.caseRecord, "$.caseRecord", issues);
  } else {
    issues.push({
      path: "$",
      message: "ACH MCP output must include caseRecord or result."
    });
  }

  return issues.length === 0 ? OK : invalid(issues);
}

export function validateForecastMcpResultEnvelope(
  value: unknown,
  _context: McpResultValidationContext = {}
): McpResultValidation {
  const issues: McpResultValidationIssue[] = [];
  const output = requireRecord(value, "$", "forecast MCP output", issues);
  if (!output) return invalid(issues);

  let recognized = false;
  if (hasOwn(output, "baseRate")) {
    recognized = true;
    validateForecastBaseRate(output.baseRate, "$.baseRate", issues);
  }
  if (hasOwn(output, "indicatorAssessment")) {
    recognized = true;
    validateForecastIndicatorAssessment(output.indicatorAssessment, "$.indicatorAssessment", issues);
  }
  if (hasOwn(output, "estimate")) {
    recognized = true;
    validateForecastEstimate(output.estimate, "$.estimate", issues);
  }
  if (hasOwn(output, "scenarioSet")) {
    recognized = true;
    validateForecastScenarioSet(output.scenarioSet, "$.scenarioSet", issues);
  }
  if (hasOwn(output, "watchlist")) {
    recognized = true;
    validateForecastWatchlist(output.watchlist, "$.watchlist", issues);
  }
  if (hasOwn(output, "warnings")) validateStringArray(output.warnings, "$.warnings", issues);
  if (!recognized) {
    issues.push({
      path: "$",
      message: "Forecast MCP output must include baseRate, indicatorAssessment, estimate, scenarioSet, or watchlist."
    });
  }

  return issues.length === 0 ? OK : invalid(issues);
}

export function validateStatusWarningsEnvelope(
  value: unknown,
  path: string,
  allowedStatuses: readonly string[],
  issues: McpResultValidationIssue[]
): void {
  const envelope = requireRecord(value, path, "result envelope", issues);
  if (!envelope) return;
  if (!isOneOf(envelope.status, allowedStatuses)) {
    issues.push({
      path: `${path}.status`,
      message: `status must be one of ${allowedStatuses.join(", ")}.`
    });
  }
  validateStringArray(envelope.warnings, `${path}.warnings`, issues);
}

export function validateKnowledgeUnitArray(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "KnowledgeUnit list must be an array." });
    return;
  }

  value.forEach((unit, index) => {
    const unitPath = `${path}[${index}]`;
    const record = requireRecord(unit, unitPath, "KnowledgeUnit", issues);
    if (!record) return;
    if (!isNonEmptyString(record.id)) issues.push({ path: `${unitPath}.id`, message: "KnowledgeUnit id is required." });
    if (!isNonEmptyString(record.sourceUri)) {
      issues.push({ path: `${unitPath}.sourceUri`, message: "KnowledgeUnit sourceUri is required." });
    }
    if (!isNonEmptyString(record.sourceType)) {
      issues.push({ path: `${unitPath}.sourceType`, message: "KnowledgeUnit sourceType is required." });
    }
    if (!isNonEmptyString(record.extractedAt)) {
      issues.push({ path: `${unitPath}.extractedAt`, message: "KnowledgeUnit extractedAt is required." });
    }
    if (!Array.isArray(record.claims)) {
      issues.push({ path: `${unitPath}.claims`, message: "KnowledgeUnit claims must be an array." });
    }
    if (!isRecord(record.provenance)) {
      issues.push({ path: `${unitPath}.provenance`, message: "KnowledgeUnit provenance must be an object." });
    }
    validateStringArray(record.tags, `${unitPath}.tags`, issues);
  });
}

export function validateArtifactArray(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "artifact list must be an array." });
    return;
  }

  value.forEach((artifact, index) => {
    const artifactPath = `${path}[${index}]`;
    const record = requireRecord(artifact, artifactPath, "artifact", issues);
    if (!record) return;
    if (!isNonEmptyString(record.id)) issues.push({ path: `${artifactPath}.id`, message: "artifact id is required." });
    if (record.type !== "raw" && record.type !== "redacted") {
      issues.push({ path: `${artifactPath}.type`, message: "artifact type must be raw or redacted." });
    }
    if (!isNonEmptyString(record.sourceUri)) {
      issues.push({ path: `${artifactPath}.sourceUri`, message: "artifact sourceUri is required." });
    }
    if (!isNonEmptyString(record.capturedAt)) {
      issues.push({ path: `${artifactPath}.capturedAt`, message: "artifact capturedAt is required." });
    }
    if (!isNonEmptyString(record.contentHash)) {
      issues.push({ path: `${artifactPath}.contentHash`, message: "artifact contentHash is required." });
    }
    if (!hasOwn(record, "payload")) {
      issues.push({ path: `${artifactPath}.payload`, message: "artifact payload field is required." });
    }
  });
}

export function formatValidationIssues(issues: McpResultValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function validateRagSummary(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const summary = requireRecord(value, path, "RAG corpus summary", issues);
  if (!summary) return;
  if (!isNonEmptyString(summary.corpusId)) issues.push({ path: `${path}.corpusId`, message: "corpusId is required." });
  if (!isNonEmptyString(summary.title)) issues.push({ path: `${path}.title`, message: "title is required." });
  if (!isNonEmptyString(summary.version)) issues.push({ path: `${path}.version`, message: "version is required." });
  if (!isNonNegativeNumber(summary.unitCount)) {
    issues.push({ path: `${path}.unitCount`, message: "unitCount must be a non-negative number." });
  }
  if (!isNonNegativeNumber(summary.claimCount)) {
    issues.push({ path: `${path}.claimCount`, message: "claimCount must be a non-negative number." });
  }
  validateStringArray(summary.tags, `${path}.tags`, issues);
  if (!isRecord(summary.reliability)) {
    issues.push({ path: `${path}.reliability`, message: "reliability must be an object." });
  }
}

function validateAchCaseRecord(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const record = requireRecord(value, path, "ACH caseRecord", issues);
  if (!record) return;
  if (!isNonEmptyString(record.id)) issues.push({ path: `${path}.id`, message: "caseRecord id is required." });
  if (!isNonEmptyString(record.question)) {
    issues.push({ path: `${path}.question`, message: "caseRecord question is required." });
  }
  if (!Array.isArray(record.hypotheses)) {
    issues.push({ path: `${path}.hypotheses`, message: "caseRecord hypotheses must be an array." });
  }
  if (!Array.isArray(record.evidence)) {
    issues.push({ path: `${path}.evidence`, message: "caseRecord evidence must be an array." });
  }
  if (!Array.isArray(record.assessments)) {
    issues.push({ path: `${path}.assessments`, message: "caseRecord assessments must be an array." });
  }
}

function validateAchAnalysisResult(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const result = requireRecord(value, path, "ACH analysis result", issues);
  if (!result) return;
  if (!isNonEmptyString(result.caseId)) issues.push({ path: `${path}.caseId`, message: "caseId is required." });
  if (!isNonEmptyString(result.question)) issues.push({ path: `${path}.question`, message: "question is required." });
  if (!isNonEmptyString(result.matrix)) issues.push({ path: `${path}.matrix`, message: "matrix is required." });
  if (!Array.isArray(result.ranked)) issues.push({ path: `${path}.ranked`, message: "ranked must be an array." });
  if (!Array.isArray(result.diagnosticity)) {
    issues.push({ path: `${path}.diagnosticity`, message: "diagnosticity must be an array." });
  }
  validateStringArray(result.survivors, `${path}.survivors`, issues);
  validateStringArray(result.evidenceBundleIds, `${path}.evidenceBundleIds`, issues);
  validateAchCaseRecord(result.caseRecord, `${path}.caseRecord`, issues);
}

function validateForecastBaseRate(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const baseRate = requireRecord(value, path, "forecast baseRate", issues);
  if (!baseRate) return;
  if (!isNonEmptyString(baseRate.questionId)) issues.push({ path: `${path}.questionId`, message: "questionId is required." });
  if (!isRecord(baseRate.horizon)) issues.push({ path: `${path}.horizon`, message: "horizon must be an object." });
  if (!isNonNegativeNumber(baseRate.horizonMonths)) {
    issues.push({ path: `${path}.horizonMonths`, message: "horizonMonths must be a non-negative number." });
  }
  if (!isNonEmptyString(baseRate.referenceClass)) {
    issues.push({ path: `${path}.referenceClass`, message: "referenceClass is required." });
  }
  validateProbability(baseRate.annualProbability, `${path}.annualProbability`, issues);
  validateProbability(baseRate.probability, `${path}.probability`, issues);
  validateProbabilityRange(baseRate.probabilityRange, `${path}.probabilityRange`, issues);
  if (!isOneOf(baseRate.confidence, ["low", "medium", "high"])) {
    issues.push({ path: `${path}.confidence`, message: "confidence must be low, medium, or high." });
  }
  validateStringArray(baseRate.rationale, `${path}.rationale`, issues);
}

function validateForecastIndicatorAssessment(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const assessment = requireRecord(value, path, "forecast indicatorAssessment", issues);
  if (!assessment) return;
  if (!Array.isArray(assessment.scores)) issues.push({ path: `${path}.scores`, message: "scores must be an array." });
  if (!isFiniteNumber(assessment.netScore)) issues.push({ path: `${path}.netScore`, message: "netScore must be a number." });
  if (!isFiniteNumber(assessment.supportScore)) {
    issues.push({ path: `${path}.supportScore`, message: "supportScore must be a number." });
  }
  if (!isFiniteNumber(assessment.dragScore)) issues.push({ path: `${path}.dragScore`, message: "dragScore must be a number." });
  validateProbability(assessment.confidence, `${path}.confidence`, issues);
  validateStringArray(assessment.rationale, `${path}.rationale`, issues);
}

function validateForecastEstimate(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const estimate = requireRecord(value, path, "forecast estimate", issues);
  if (!estimate) return;
  if (!isRecord(estimate.question)) issues.push({ path: `${path}.question`, message: "question must be an object." });
  if (!isRecord(estimate.horizon)) issues.push({ path: `${path}.horizon`, message: "horizon must be an object." });
  validateForecastBaseRate(estimate.baseRate, `${path}.baseRate`, issues);
  validateForecastIndicatorAssessment(estimate.indicatorAssessment, `${path}.indicatorAssessment`, issues);
  validateProbability(estimate.probability, `${path}.probability`, issues);
  validateProbabilityRange(estimate.probabilityRange, `${path}.probabilityRange`, issues);
  validateProbabilityRange(estimate.confidenceBand, `${path}.confidenceBand`, issues);
  if (!isFiniteNumber(estimate.adjustment)) issues.push({ path: `${path}.adjustment`, message: "adjustment must be a number." });
  validateStringArray(estimate.rationale, `${path}.rationale`, issues);
}

function validateForecastScenarioSet(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const scenarioSet = requireRecord(value, path, "forecast scenarioSet", issues);
  if (!scenarioSet) return;
  if (!isNonEmptyString(scenarioSet.questionId)) {
    issues.push({ path: `${path}.questionId`, message: "questionId is required." });
  }
  if (!isRecord(scenarioSet.horizon)) issues.push({ path: `${path}.horizon`, message: "horizon must be an object." });
  if (!Array.isArray(scenarioSet.scenarios)) {
    issues.push({ path: `${path}.scenarios`, message: "scenarios must be an array." });
  } else {
    scenarioSet.scenarios.forEach((scenario, index) => validateForecastScenario(scenario, `${path}.scenarios[${index}]`, issues));
  }
  validateStringArray(scenarioSet.rationale, `${path}.rationale`, issues);
}

function validateForecastScenario(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const scenario = requireRecord(value, path, "forecast scenario", issues);
  if (!scenario) return;
  if (!isNonEmptyString(scenario.id)) issues.push({ path: `${path}.id`, message: "scenario id is required." });
  if (!isNonEmptyString(scenario.label)) issues.push({ path: `${path}.label`, message: "scenario label is required." });
  validateProbability(scenario.probability, `${path}.probability`, issues);
  validateProbabilityRange(scenario.probabilityRange, `${path}.probabilityRange`, issues);
  validateStringArray(scenario.drivers, `${path}.drivers`, issues);
  validateStringArray(scenario.signposts, `${path}.signposts`, issues);
}

function validateForecastWatchlist(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const watchlist = requireRecord(value, path, "forecast watchlist", issues);
  if (!watchlist) return;
  if (!isNonEmptyString(watchlist.questionId)) {
    issues.push({ path: `${path}.questionId`, message: "questionId is required." });
  }
  if (!Array.isArray(watchlist.items)) issues.push({ path: `${path}.items`, message: "items must be an array." });
  if (!isNonEmptyString(watchlist.text)) issues.push({ path: `${path}.text`, message: "text is required." });
}

function validateProbability(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    issues.push({ path, message: "probability must be a number from 0 to 1." });
  }
}

function validateProbabilityRange(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  const range = requireRecord(value, path, "probability range", issues);
  if (!range) return;
  validateProbability(range.lower, `${path}.lower`, issues);
  validateProbability(range.upper, `${path}.upper`, issues);
  if (isFiniteNumber(range.lower) && isFiniteNumber(range.upper) && range.lower > range.upper) {
    issues.push({ path, message: "probability range lower must be <= upper." });
  }
}

function validateStringArray(value: unknown, path: string, issues: McpResultValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be a string array." });
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      issues.push({ path: `${path}[${index}]`, message: "must be a string." });
    }
  });
}

function requireRecord(
  value: unknown,
  path: string,
  label: string,
  issues: McpResultValidationIssue[]
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    issues.push({ path, message: `${label} must be an object.` });
    return undefined;
  }
  return value;
}

function invalid(issues: McpResultValidationIssue[]): McpResultValidation {
  return {
    ok: false,
    issues,
    message: formatValidationIssues(issues)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isOneOf<T extends readonly unknown[]>(value: unknown, options: T): value is T[number] {
  return options.includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}
