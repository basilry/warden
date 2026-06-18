import type { ApprovalRequest } from "../agent/approval.ts";
import type { SourceReview, SourceRiskFlag } from "../agent/sourcevet-types.ts";
import type { AchAnalysisResult, VerificationReport } from "../agent/types.ts";
import type { RuntimeAnswer, AnswerContext } from "./answer.ts";
import type { RuntimeForecastProducts } from "./analysis-products.ts";
import type { SecurityReportConfidence } from "./report-schema.ts";
import type { RuntimeRun, RuntimeRunStatus } from "./types.ts";

export type RuntimeConfidenceLevel = "low" | "medium" | "high";

export type RuntimeConfidenceAssessment = {
  confidence: RuntimeConfidenceLevel;
  confidenceScore: number;
  reasons: string[];
  whyLow: string[];
  howToImprove: string[];
  positiveSignals: string[];
  limitingFactors: string[];
  blockers: string[];
};

export type RuntimeConfidenceOverrides = {
  runStatus?: RuntimeRunStatus;
  approvals?: ApprovalRequest[];
  ach?: AchAnalysisResult;
  verification?: VerificationReport;
  sourceReview?: SourceReview;
  forecast?: RuntimeForecastProducts;
  answer?: RuntimeAnswer;
};

type RuntimeConfidenceFacts = {
  runStatus?: RuntimeRunStatus;
  approvals: ApprovalRequest[];
  ach?: AchAnalysisResult;
  verification?: VerificationReport;
  sourceReview?: SourceReview;
  forecast?: RuntimeForecastProducts;
  answer?: RuntimeAnswer;
  domainConfidence?: number;
  domainEvidenceCount: number;
  ragUnitCount: number;
  claimGraphContradictions: number;
  canonicalClaimCount: number;
  evidenceLedgerEntries: number;
  fetchedEvidenceCount: number;
  modelWarningCount: number;
};

export function assessRuntimeConfidence(run: RuntimeRun): RuntimeConfidenceAssessment;
export function assessRuntimeConfidence(
  context: AnswerContext,
  answer?: RuntimeAnswer,
  overrides?: RuntimeConfidenceOverrides
): RuntimeConfidenceAssessment;
export function assessRuntimeConfidence(
  input: RuntimeRun | AnswerContext,
  answer?: RuntimeAnswer,
  overrides: RuntimeConfidenceOverrides = {}
): RuntimeConfidenceAssessment {
  const facts = isRuntimeRun(input)
    ? factsFromRun(input, { ...overrides, answer: overrides.answer ?? answer })
    : factsFromAnswerContext(input, answer, overrides);
  return assessFacts(facts);
}

export function runtimeConfidenceToReportConfidence(
  assessment: RuntimeConfidenceAssessment
): SecurityReportConfidence {
  return {
    level: assessment.confidence,
    rationale:
      assessment.reasons.slice(0, 3).join(" ") ||
      `Runtime confidence score is ${Math.round(assessment.confidenceScore * 100)}%.`
  };
}

function assessFacts(facts: RuntimeConfidenceFacts): RuntimeConfidenceAssessment {
  const positiveSignals: string[] = [];
  const limitingFactors: string[] = [];
  const blockers: string[] = [];
  const howToImprove: string[] = [];
  let score = 0.12;

  const pendingApprovals = facts.approvals.filter((approval) => approval.status === "pending");
  const deniedApprovals = facts.approvals.filter((approval) => approval.status === "denied");

  if (facts.runStatus === "succeeded") {
    score += 0.05;
    positiveSignals.push("Runtime completed without a pending execution gate.");
  } else if (facts.runStatus === "waiting_approval") {
    score -= 0.24;
    blockers.push("Runtime is waiting for human approval.");
    limitingFactors.push("Pending approval prevents external evidence from being incorporated.");
    howToImprove.push("Resolve the pending approval and resume the same run so new evidence can enter SourceVet and ACH.");
  } else if (facts.runStatus === "failed") {
    score -= 0.22;
    blockers.push("Runtime failed before a clean verdict could be produced.");
    limitingFactors.push("A failed run cannot support a final decision without rerun or repair.");
    howToImprove.push("Fix the runtime failure and rerun the analysis before relying on the answer.");
  }

  if (pendingApprovals.length > 0) {
    score -= 0.3;
    blockers.push(`Pending approvals: ${pendingApprovals.map((approval) => approval.action.name).join(", ")}.`);
    limitingFactors.push("External or higher-risk actions remain blocked by policy approval.");
    howToImprove.push("Approve or deny the pending action explicitly, then rerun confidence after the runtime resumes.");
  }
  if (deniedApprovals.length > 0) {
    score -= 0.14;
    limitingFactors.push(`Denied approvals limited collection: ${deniedApprovals.map((approval) => approval.action.name).join(", ")}.`);
    howToImprove.push("If the denied collection is still required, replace it with approved local evidence or a lower-risk source path.");
  }

  score = applyAchSignals(score, facts, positiveSignals, limitingFactors, blockers, howToImprove);
  score = applyVerificationSignals(score, facts, positiveSignals, limitingFactors, blockers, howToImprove);
  score = applySourceVetSignals(score, facts, positiveSignals, limitingFactors, blockers, howToImprove);
  score = applyForecastSignals(score, facts, positiveSignals, limitingFactors, howToImprove);
  score = applyContextSignals(score, facts, positiveSignals, limitingFactors, howToImprove);
  score = applyAnswerSignals(score, facts, limitingFactors, howToImprove);

  const confidenceScore = roundScore(clamp(score, 0, 0.98));
  const confidence = scoreToConfidence(confidenceScore);
  const normalizedBlockers = uniqueNonEmpty(blockers);
  const normalizedLimits = uniqueNonEmpty(limitingFactors);
  const normalizedPositive = uniqueNonEmpty(positiveSignals);
  const reasons = uniqueNonEmpty([...normalizedPositive.slice(0, 5), ...normalizedLimits.slice(0, 5)]).slice(0, 10);

  return {
    confidence,
    confidenceScore,
    reasons: reasons.length > 0 ? reasons : [`Runtime confidence score is ${Math.round(confidenceScore * 100)}%.`],
    whyLow: confidence === "low" ? uniqueNonEmpty([...normalizedBlockers, ...normalizedLimits]).slice(0, 8) : [],
    howToImprove: buildImprovementGuidance(howToImprove, facts).slice(0, 8),
    positiveSignals: normalizedPositive,
    limitingFactors: normalizedLimits,
    blockers: normalizedBlockers
  };
}

function applyAchSignals(
  score: number,
  facts: RuntimeConfidenceFacts,
  positiveSignals: string[],
  limitingFactors: string[],
  blockers: string[],
  howToImprove: string[]
): number {
  const ach = facts.ach;
  if (!ach) {
    blockers.push("ACH result is missing.");
    limitingFactors.push("No ACH matrix is available to separate competing hypotheses.");
    howToImprove.push("Run ACH with at least three competing hypotheses and structured evidence bundles.");
    return score - 0.2;
  }

  const evidenceCount = ach.caseRecord.evidence.length;
  const survivorCount = ach.survivors.length;
  score += 0.15;
  positiveSignals.push(`ACH result is present for case ${ach.caseId}.`);

  if (evidenceCount === 0) {
    score -= 0.18;
    blockers.push("ACH has no structured evidence.");
    limitingFactors.push("ACH cannot support a decision without evidence rows.");
    howToImprove.push("Add directly relevant evidence bundles with reliability codes before rerunning ACH.");
  } else {
    score += Math.min(evidenceCount / 6, 1) * 0.14;
    positiveSignals.push(`ACH uses ${evidenceCount} structured evidence item(s).`);
    if (evidenceCount < 3) {
      limitingFactors.push("ACH evidence count is below the minimum useful threshold of three items.");
      howToImprove.push("Add independent evidence until ACH has at least three directly relevant items.");
    }
  }

  if (isAchMatrixComplete(ach)) {
    score += 0.08;
    positiveSignals.push("ACH matrix covers every evidence/hypothesis pair.");
  } else {
    score -= 0.12;
    blockers.push("ACH matrix is incomplete.");
    limitingFactors.push("Missing C/I/N cells weaken the ranking authority.");
    howToImprove.push("Complete every ACH evidence/hypothesis cell before raising confidence.");
  }

  if (survivorCount === 0) {
    score -= 0.16;
    blockers.push("ACH produced no surviving hypothesis.");
    limitingFactors.push("No hypothesis currently has enough support to act as the answer.");
    howToImprove.push("Reframe the case and add hypotheses/evidence until ACH produces a survivor.");
  } else if (survivorCount === 1) {
    score += 0.06;
    positiveSignals.push("ACH narrowed the case to one surviving hypothesis.");
  } else {
    score -= Math.min((survivorCount - 1) * 0.04, 0.12);
    limitingFactors.push(`ACH still has ${survivorCount} surviving hypotheses.`);
    howToImprove.push("Collect disconfirming evidence that separates the remaining ACH survivors.");
  }

  const separation = contradictionSeparation(ach);
  if (separation >= 0.5) {
    score += 0.04;
    positiveSignals.push(`Top ACH survivor is separated by ${roundScore(separation)} contradiction points.`);
  } else if (survivorCount > 0) {
    limitingFactors.push("Top ACH hypothesis is not clearly separated from alternatives.");
  }

  const averageDiagnosticity = average(ach.diagnosticity.map((item) => item.diagnosticity));
  if (averageDiagnosticity >= 1) {
    score += 0.03;
    positiveSignals.push("ACH evidence has useful diagnosticity across hypotheses.");
  } else if (evidenceCount > 0) {
    limitingFactors.push("ACH evidence has low diagnosticity and may not distinguish hypotheses well.");
    howToImprove.push("Prefer evidence that supports one hypothesis while contradicting another.");
  }

  return score;
}

function applyVerificationSignals(
  score: number,
  facts: RuntimeConfidenceFacts,
  positiveSignals: string[],
  limitingFactors: string[],
  blockers: string[],
  howToImprove: string[]
): number {
  const verification = facts.verification;
  if (!verification) {
    if (facts.ach) {
      limitingFactors.push("Verification report is missing for the ACH output.");
      howToImprove.push("Run verifier checks against ACH, policy, SourceVet, and residual-risk constraints.");
    }
    return score;
  }

  if (verification.status === "pass") {
    score += 0.1;
    positiveSignals.push("Verifier status is pass.");
  } else {
    score -= 0.18;
    blockers.push("Verifier status is fail.");
    limitingFactors.push("Verifier failed at least one runtime authority check.");
    howToImprove.push("Fix failed verifier checks before promoting the runtime verdict.");
  }

  if (verification.residualRisk.length > 0) {
    score -= Math.min(verification.residualRisk.length, 4) * 0.025;
    limitingFactors.push(`Verifier left ${verification.residualRisk.length} residual risk item(s).`);
    howToImprove.push("Close or explicitly accept verifier residual risks before raising confidence.");
  }

  return score;
}

function applySourceVetSignals(
  score: number,
  facts: RuntimeConfidenceFacts,
  positiveSignals: string[],
  limitingFactors: string[],
  blockers: string[],
  howToImprove: string[]
): number {
  const sourceReview = facts.sourceReview;
  const evidenceNeedsReview = Boolean(facts.ach || facts.fetchedEvidenceCount > 0 || facts.ragUnitCount > 0);
  if (!sourceReview) {
    if (evidenceNeedsReview) {
      score -= 0.03;
      limitingFactors.push("SourceVet review is missing for the evidence currently in use.");
      howToImprove.push("Run SourceVet on fetched/RAG knowledge units and feed only vetted evidence into ACH.");
    }
    return score;
  }

  if (sourceReview.status === "pass" && sourceReview.flags.length === 0) {
    score += 0.12;
    positiveSignals.push("SourceVet passed with no source-risk flags.");
  } else if (sourceReview.status === "pass") {
    score += 0.06;
    limitingFactors.push(`SourceVet passed but left ${sourceReview.flags.length} flag(s).`);
  } else if (sourceReview.status === "review_required") {
    score += 0.01;
    limitingFactors.push("SourceVet requires review before confidence can be raised.");
    howToImprove.push("Resolve SourceVet review-required flags with independent corroboration or source replacement.");
  } else {
    score -= 0.18;
    blockers.push("SourceVet failed the current source set.");
    limitingFactors.push("SourceVet failure prevents the evidence set from supporting a high-confidence verdict.");
    howToImprove.push("Remove or replace failed sources, then rerun SourceVet and ACH.");
  }

  const sourcePenalty = Math.min(
    sourceReview.flags.reduce((total, flag) => total + severityPenalty(flag), 0),
    0.26
  );
  score -= sourcePenalty;
  for (const flag of sourceReview.flags.slice(0, 3)) {
    limitingFactors.push(`SourceVet ${flag.severity} flag ${flag.code}: ${flag.summary}`);
  }
  if (sourceReview.flags.some((flag) => flag.severity === "high" || flag.severity === "critical")) {
    blockers.push("High-severity SourceVet flags remain unresolved.");
  }

  if (sourceReview.independentCorroboration.status === "pass") {
    score += 0.04;
    positiveSignals.push("SourceVet found sufficient independent corroboration.");
  } else if (sourceReview.independentCorroboration.requiredClaims.length > 0) {
    limitingFactors.push("Independent corroboration is still required for one or more claims.");
    howToImprove.push("Add independent sources for high-confidence claims that currently lack corroboration.");
  }

  if (sourceReview.circularLineage.length > 0) {
    score -= 0.06;
    limitingFactors.push("Circular source lineage is present.");
    howToImprove.push("Break circular citation chains by adding primary or independently sourced evidence.");
  }

  return score;
}

function applyForecastSignals(
  score: number,
  facts: RuntimeConfidenceFacts,
  positiveSignals: string[],
  limitingFactors: string[],
  howToImprove: string[]
): number {
  const forecast = facts.forecast;
  if (!forecast) {
    limitingFactors.push("Forecast products are missing, so forward-looking confidence cannot be cross-checked.");
    howToImprove.push("Build forecast products or watch indicators when the answer makes a forward-looking judgment.");
    return score;
  }

  const band = forecast.estimate.confidenceBand.label;
  if (band === "high") {
    score += 0.07;
    positiveSignals.push("Forecast confidence band is high.");
  } else if (band === "medium") {
    score += 0.04;
    positiveSignals.push("Forecast confidence band is medium.");
  } else {
    score -= 0.03;
    limitingFactors.push("Forecast confidence band is low.");
    howToImprove.push("Increase forecast confidence by confirming observed indicators and narrowing the probability range.");
  }

  const indicatorConfidence = forecast.estimate.indicatorAssessment.confidence;
  if (indicatorConfidence >= 0.65) {
    score += 0.03;
    positiveSignals.push(`Forecast indicator confidence is ${roundScore(indicatorConfidence)}.`);
  } else {
    score -= 0.02;
    limitingFactors.push(`Forecast indicator confidence is only ${roundScore(indicatorConfidence)}.`);
  }

  if (forecast.warnings.length > 0) {
    score -= Math.min(forecast.warnings.length * 0.02, 0.06);
    limitingFactors.push(`Forecast emitted ${forecast.warnings.length} warning(s).`);
    howToImprove.push("Address forecast warnings and recalculate the estimate before raising confidence.");
  }

  return score;
}

function applyContextSignals(
  score: number,
  facts: RuntimeConfidenceFacts,
  positiveSignals: string[],
  limitingFactors: string[],
  howToImprove: string[]
): number {
  if (facts.domainConfidence !== undefined) {
    if (facts.domainConfidence >= 0.65) {
      score += 0.03;
      positiveSignals.push(`Domain grounding confidence is ${roundScore(facts.domainConfidence)}.`);
    } else {
      score -= 0.02;
      limitingFactors.push(`Domain grounding confidence is ${roundScore(facts.domainConfidence)}.`);
      howToImprove.push("Clarify the objective or add domain-specific terms so grounding can classify the question confidently.");
    }
  }
  if (facts.domainEvidenceCount > 0) {
    score += Math.min(facts.domainEvidenceCount, 4) * 0.01;
    positiveSignals.push(`Domain grounding contributed ${facts.domainEvidenceCount} evidence item(s).`);
  }
  if (facts.ragUnitCount > 0) {
    score += Math.min(facts.ragUnitCount, 6) * 0.008;
    positiveSignals.push(`Local RAG contributed ${facts.ragUnitCount} knowledge unit(s).`);
  }
  if (facts.canonicalClaimCount > 0) {
    score += 0.02;
    positiveSignals.push(`Claim graph normalized ${facts.canonicalClaimCount} claim(s).`);
  }
  if (facts.claimGraphContradictions > 0) {
    score -= Math.min(facts.claimGraphContradictions, 4) * 0.025;
    limitingFactors.push(`Claim graph contains ${facts.claimGraphContradictions} contradiction relation(s).`);
    howToImprove.push("Resolve claim-graph contradictions by checking source dates, scope, and independent corroboration.");
  }
  if (facts.evidenceLedgerEntries > 0) {
    score += 0.02;
    positiveSignals.push(`Evidence ledger tracks ${facts.evidenceLedgerEntries} entry/entries.`);
  }
  if (facts.fetchedEvidenceCount > 0) {
    score += Math.min(facts.fetchedEvidenceCount, 4) * 0.015;
    positiveSignals.push(`Runtime incorporated ${facts.fetchedEvidenceCount} fetched evidence unit(s).`);
  }
  if (facts.modelWarningCount > 0) {
    score -= Math.min(facts.modelWarningCount, 4) * 0.015;
    limitingFactors.push(`Model responses emitted ${facts.modelWarningCount} warning(s).`);
  }
  return score;
}

function applyAnswerSignals(
  score: number,
  facts: RuntimeConfidenceFacts,
  limitingFactors: string[],
  howToImprove: string[]
): number {
  const answer = facts.answer;
  if (!answer) return score;

  if (answer.blockedActions.length > 0) {
    score -= Math.min(answer.blockedActions.length, 3) * 0.04;
    limitingFactors.push(`Answer lists ${answer.blockedActions.length} blocked action(s).`);
  }
  if (answer.uncertainty.length > 4) {
    score -= Math.min(answer.uncertainty.length - 4, 4) * 0.02;
    limitingFactors.push(`Answer carries ${answer.uncertainty.length} uncertainty item(s).`);
    howToImprove.push("Work through the answer uncertainty list and rerun the verdict after closing the highest-risk items.");
  }
  return score;
}

function buildImprovementGuidance(guidance: string[], facts: RuntimeConfidenceFacts): string[] {
  const fallback = facts.forecast?.watchlist.items[0]?.trigger
    ? `Monitor the top watch trigger and rerun confidence when it changes: ${facts.forecast.watchlist.items[0].trigger}`
    : "Keep monitoring for new evidence and rerun the verdict when material facts change.";
  return uniqueNonEmpty([...guidance, fallback]);
}

function factsFromAnswerContext(
  context: AnswerContext,
  answer: RuntimeAnswer | undefined,
  overrides: RuntimeConfidenceOverrides
): RuntimeConfidenceFacts {
  const sourceReview = overrides.sourceReview ?? context.teamResult?.outputs.sourceReview;
  return {
    runStatus: overrides.runStatus ?? context.runStatus,
    approvals: overrides.approvals ?? context.approvals,
    ach: overrides.ach ?? context.teamResult?.outputs.ach,
    verification: overrides.verification ?? context.teamResult?.outputs.verification,
    sourceReview,
    forecast: overrides.forecast ?? context.forecast,
    answer: overrides.answer ?? answer,
    domainConfidence: context.domainGrounding?.confidence,
    domainEvidenceCount: context.domainGrounding?.evidence.length ?? 0,
    ragUnitCount: context.ragContext?.units.length ?? 0,
    claimGraphContradictions: context.claimGraph?.contradictionCount ?? 0,
    canonicalClaimCount: context.claimGraph?.canonicalClaimCount ?? 0,
    evidenceLedgerEntries: context.evidenceLedger?.entries.length ?? 0,
    fetchedEvidenceCount: context.fetchedEvidence?.length ?? 0,
    modelWarningCount: context.modelResponses.reduce((total, response) => total + response.warnings.length, 0)
  };
}

function factsFromRun(run: RuntimeRun, overrides: RuntimeConfidenceOverrides): RuntimeConfidenceFacts {
  const sourceReview = overrides.sourceReview ?? run.outputs.sourceReview ?? run.outputs.resumeResult?.sourceReview;
  const fetchedEvidenceCount = run.outputs.fetchedEvidence?.length ?? run.outputs.resumeResult?.fetchedUnits.length ?? 0;
  return {
    runStatus: overrides.runStatus ?? run.status,
    approvals: overrides.approvals ?? run.approvals,
    ach: overrides.ach ?? run.outputs.ach ?? run.outputs.resumeResult?.achAfter,
    verification: overrides.verification,
    sourceReview,
    forecast: overrides.forecast ?? run.outputs.forecast,
    answer: overrides.answer ?? run.outputs.answer,
    domainConfidence: run.outputs.domainGrounding?.confidence,
    domainEvidenceCount: run.outputs.domainGrounding?.evidence.length ?? 0,
    ragUnitCount: run.outputs.ragContext?.units.length ?? 0,
    claimGraphContradictions: run.outputs.claimGraph?.contradictionCount ?? 0,
    canonicalClaimCount: run.outputs.claimGraph?.canonicalClaimCount ?? 0,
    evidenceLedgerEntries: run.outputs.evidenceLedger?.entries.length ?? 0,
    fetchedEvidenceCount,
    modelWarningCount: run.modelResponses.reduce((total, response) => total + response.warnings.length, 0)
  };
}

function isAchMatrixComplete(ach: AchAnalysisResult): boolean {
  const expected = ach.caseRecord.evidence.length * ach.caseRecord.hypotheses.length;
  if (expected === 0 || ach.caseRecord.assessments.length < expected) return false;
  for (const evidence of ach.caseRecord.evidence) {
    for (const hypothesis of ach.caseRecord.hypotheses) {
      if (
        !ach.caseRecord.assessments.some(
          (cell) =>
            cell.evidenceId === evidence.id &&
            cell.hypothesisId === hypothesis.id &&
            (cell.verdict === "C" || cell.verdict === "I" || cell.verdict === "N")
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function contradictionSeparation(ach: AchAnalysisResult): number {
  if (ach.ranked.length < 2 || ach.survivors.length !== 1) return 0;
  const survivor = ach.ranked.find((score) => score.hypothesis === ach.survivors[0]) ?? ach.ranked[0];
  const challenger = ach.ranked.find((score) => score.hypothesis !== survivor.hypothesis);
  if (!challenger) return 0;
  return challenger.contradictions - survivor.contradictions;
}

function severityPenalty(flag: SourceRiskFlag): number {
  if (flag.severity === "critical") return 0.18;
  if (flag.severity === "high") return 0.12;
  if (flag.severity === "medium") return 0.07;
  if (flag.severity === "low") return 0.03;
  return 0.01;
}

function scoreToConfidence(score: number): RuntimeConfidenceLevel {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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

function isRuntimeRun(value: RuntimeRun | AnswerContext): value is RuntimeRun {
  return "outputs" in value && "maxIterations" in value && "iteration" in value;
}
