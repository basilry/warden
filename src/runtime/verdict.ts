import type { ApprovalRequest } from "../agent/approval.ts";
import type { SourceReview } from "../agent/sourcevet-types.ts";
import type { AchAnalysisResult, VerificationReport } from "../agent/types.ts";
import type { RuntimeAnswer, AnswerContext } from "./answer.ts";
import {
  assessRuntimeConfidence,
  type RuntimeConfidenceAssessment,
  type RuntimeConfidenceLevel,
  type RuntimeConfidenceOverrides
} from "./confidence-assessment.ts";
import { formatConfidenceKo, formatHypothesisKo } from "./korean-format.ts";
import type { RuntimeRun, RuntimeRunStatus } from "./types.ts";

export type RuntimeVerdictStatus = "blocked" | "insufficient_evidence" | "provisional" | "supported" | "strong";

export type RuntimeVerdict = {
  status: RuntimeVerdictStatus;
  decision: string;
  topHypothesis?: string;
  confidence: RuntimeConfidenceLevel;
  confidenceScore: number;
  reasons: string[];
  blockers: string[];
  nextAction: string;
};

export type RuntimeVerdictOverrides = RuntimeConfidenceOverrides;

type RuntimeVerdictFacts = {
  runStatus?: RuntimeRunStatus;
  approvals: ApprovalRequest[];
  answer?: RuntimeAnswer;
  ach?: AchAnalysisResult;
  verification?: VerificationReport;
  sourceReview?: SourceReview;
  survivorNames: string[];
  fetchedEvidenceCount: number;
  forecastConfidence?: "low" | "medium" | "high";
};

export function deriveRuntimeVerdict(run: RuntimeRun): RuntimeVerdict;
export function deriveRuntimeVerdict(
  context: AnswerContext,
  answer?: RuntimeAnswer,
  overrides?: RuntimeVerdictOverrides
): RuntimeVerdict;
export function deriveRuntimeVerdict(
  input: RuntimeRun | AnswerContext,
  answer?: RuntimeAnswer,
  overrides: RuntimeVerdictOverrides = {}
): RuntimeVerdict {
  const assessment = isRuntimeRun(input)
    ? assessRuntimeConfidence(input)
    : assessRuntimeConfidence(input, answer, overrides);
  const facts = isRuntimeRun(input)
    ? verdictFactsFromRun(input, overrides)
    : verdictFactsFromAnswerContext(input, answer, overrides);
  return buildRuntimeVerdict(facts, assessment);
}

export function deriveRuntimeVerdictFromRun(run: RuntimeRun): RuntimeVerdict {
  return deriveRuntimeVerdict(run);
}

export function formatVerdictStatusKo(status: RuntimeVerdictStatus): string {
  if (status === "blocked") return "승인 대기";
  if (status === "insufficient_evidence") return "판정 보류";
  if (status === "provisional") return "잠정 판단";
  if (status === "supported") return "현재 판단";
  return "강한 판단";
}

export function renderVerdictSummary(verdict: RuntimeVerdict): string {
  return `${formatVerdictStatusKo(verdict.status)} · 신뢰도 ${formatConfidenceKo(verdict.confidence)} (${Math.round(
    verdict.confidenceScore * 100
  )}%)`;
}

function buildRuntimeVerdict(
  facts: RuntimeVerdictFacts,
  assessment: RuntimeConfidenceAssessment
): RuntimeVerdict {
  const pendingApprovals = facts.approvals.filter((approval) => approval.status === "pending");
  const evidenceCount = facts.ach?.caseRecord.evidence.length ?? 0;
  const survivorCount = facts.survivorNames.length;
  const topHypothesis = facts.survivorNames[0] ? formatHypothesisKo(facts.survivorNames[0]) : undefined;
  const status = selectVerdictStatus(facts, assessment);
  const blockers = buildVerdictBlockers(facts, assessment);

  return {
    status,
    decision: buildDecision(status, facts, topHypothesis),
    topHypothesis,
    confidence: status === "strong" ? "high" : assessment.confidence,
    confidenceScore: assessment.confidenceScore,
    reasons: buildVerdictReasons(facts, assessment, evidenceCount, survivorCount),
    blockers,
    nextAction: buildNextAction(status, pendingApprovals, assessment)
  };
}

function selectVerdictStatus(
  facts: RuntimeVerdictFacts,
  assessment: RuntimeConfidenceAssessment
): RuntimeVerdictStatus {
  const pendingApprovals = facts.approvals.some((approval) => approval.status === "pending");
  const operationallyBlocked = pendingApprovals || facts.runStatus === "waiting_approval" || facts.runStatus === "failed";
  if (operationallyBlocked) return "blocked";

  const evidenceCount = facts.ach?.caseRecord.evidence.length ?? 0;
  const survivorCount = facts.survivorNames.length;
  const sourceFailed = facts.sourceReview?.status === "fail";
  const verificationFailed = facts.verification?.status === "fail";
  if (!facts.ach || evidenceCount === 0 || survivorCount === 0 || !isAchMatrixComplete(facts.ach) || sourceFailed || verificationFailed) {
    return "insufficient_evidence";
  }

  const hasSevereSourceFlag = facts.sourceReview?.flags.some((flag) => flag.severity === "high" || flag.severity === "critical") ?? false;
  const sourcePassed = facts.sourceReview?.status === "pass" && !hasSevereSourceFlag;
  const strongForecast = facts.forecastConfidence === "high";

  if (
    assessment.confidenceScore >= 0.82 &&
    evidenceCount >= 5 &&
    survivorCount === 1 &&
    sourcePassed &&
    strongForecast
  ) {
    return "strong";
  }

  if (assessment.confidenceScore >= 0.62 && evidenceCount >= 3 && survivorCount > 0 && !hasSevereSourceFlag) {
    return "supported";
  }

  return "provisional";
}

function buildDecision(
  status: RuntimeVerdictStatus,
  facts: RuntimeVerdictFacts,
  topHypothesis: string | undefined
): string {
  if (facts.answer?.directAnswer) return facts.answer.directAnswer;
  if (status === "blocked") {
    return "정책/승인 게이트가 해소되기 전까지 런타임 결론을 확정할 수 없습니다.";
  }
  if (status === "insufficient_evidence") {
    return topHypothesis
      ? `현재 근거로는 "${topHypothesis}" 판단을 확정하기 부족합니다.`
      : "현재 근거로는 판정 보류가 맞습니다.";
  }
  if (status === "strong") return `높은 신뢰도로 "${topHypothesis}"라고 판단합니다.`;
  if (status === "supported") return `현재 지원되는 판단은 "${topHypothesis}"입니다.`;
  return topHypothesis ? `현재 잠정 판단은 "${topHypothesis}"입니다.` : "현재 판단은 잠정 상태입니다.";
}

function buildVerdictReasons(
  facts: RuntimeVerdictFacts,
  assessment: RuntimeConfidenceAssessment,
  evidenceCount: number,
  survivorCount: number
): string[] {
  return uniqueNonEmpty([
    facts.ach ? `ACH evidence=${evidenceCount}, survivors=${survivorCount}.` : "ACH result is missing.",
    facts.sourceReview ? `SourceVet status=${facts.sourceReview.status}, flags=${facts.sourceReview.flags.length}.` : "SourceVet review is missing.",
    facts.forecastConfidence ? `Forecast confidence=${facts.forecastConfidence}.` : "Forecast confidence is missing.",
    facts.verification ? `Verification status=${facts.verification.status}.` : undefined,
    ...assessment.reasons
  ]).slice(0, 10);
}

function buildVerdictBlockers(
  facts: RuntimeVerdictFacts,
  assessment: RuntimeConfidenceAssessment
): string[] {
  const pendingApprovalBlockers = facts.approvals
    .filter((approval) => approval.status === "pending")
    .map((approval) => `${approval.action.name} approval is pending.`);
  const evidenceBlockers = [
    !facts.ach ? "ACH result is missing." : undefined,
    facts.ach && facts.ach.caseRecord.evidence.length === 0 ? "ACH evidence is empty." : undefined,
    facts.ach && !isAchMatrixComplete(facts.ach) ? "ACH matrix is incomplete." : undefined,
    facts.sourceReview?.status === "fail" ? "SourceVet failed the current source set." : undefined,
    facts.verification?.status === "fail" ? "Verification failed." : undefined
  ];
  return uniqueNonEmpty([...pendingApprovalBlockers, ...evidenceBlockers, ...assessment.blockers]);
}

function buildNextAction(
  status: RuntimeVerdictStatus,
  pendingApprovals: ApprovalRequest[],
  assessment: RuntimeConfidenceAssessment
): string {
  if (status === "blocked" && pendingApprovals[0]) {
    return `${pendingApprovals[0].action.name} approval must be resolved, then the same run should be resumed.`;
  }
  if (assessment.howToImprove[0]) return assessment.howToImprove[0];
  if (status === "strong") return "Promote the verdict into the report and continue monitoring disconfirming indicators.";
  return "Add independent evidence and rerun SourceVet/ACH before raising confidence.";
}

function verdictFactsFromAnswerContext(
  context: AnswerContext,
  answer: RuntimeAnswer | undefined,
  overrides: RuntimeVerdictOverrides
): RuntimeVerdictFacts {
  const ach = overrides.ach ?? context.teamResult?.outputs.ach;
  const sourceReview = overrides.sourceReview ?? context.teamResult?.outputs.sourceReview;
  const forecast = overrides.forecast ?? context.forecast;
  return {
    runStatus: overrides.runStatus ?? context.runStatus,
    approvals: overrides.approvals ?? context.approvals,
    answer: overrides.answer ?? answer,
    ach,
    verification: overrides.verification ?? context.teamResult?.outputs.verification,
    sourceReview,
    survivorNames: ach?.survivors ?? [],
    fetchedEvidenceCount: context.fetchedEvidence?.length ?? 0,
    forecastConfidence: forecast?.estimate.confidenceBand.label
  };
}

function verdictFactsFromRun(run: RuntimeRun, overrides: RuntimeVerdictOverrides): RuntimeVerdictFacts {
  const ach = overrides.ach ?? run.outputs.ach ?? run.outputs.resumeResult?.achAfter;
  const sourceReview = overrides.sourceReview ?? run.outputs.sourceReview ?? run.outputs.resumeResult?.sourceReview;
  const forecast = overrides.forecast ?? run.outputs.forecast;
  return {
    runStatus: overrides.runStatus ?? run.status,
    approvals: overrides.approvals ?? run.approvals,
    answer: overrides.answer ?? run.outputs.answer,
    ach,
    verification: overrides.verification,
    sourceReview,
    survivorNames: ach?.survivors ?? run.outputs.survivors ?? [],
    fetchedEvidenceCount: run.outputs.fetchedEvidence?.length ?? run.outputs.resumeResult?.fetchedUnits.length ?? 0,
    forecastConfidence: forecast?.estimate.confidenceBand.label
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
