import { isValidReliability } from "./tools/ach-local.ts";
import type { SourceReview } from "./sourcevet-types.ts";
import type {
  AchAnalysisResult,
  AchCaseRecord,
  TraceEvent,
  VerificationCheck,
  VerificationReport
} from "./types.ts";

export function createVerificationReport(input: {
  ach?: AchAnalysisResult;
  sourceReview?: SourceReview;
  trace: TraceEvent[];
  expectedAuthority?: string[];
}): VerificationReport {
  const checks: VerificationCheck[] = [
    verifyAchResultPresent(input.ach),
    ...(input.ach
      ? [
          verifyEnoughHypotheses(input.ach.caseRecord),
          verifyEvidenceReliability(input.ach.caseRecord),
          verifyMatrixComplete(input.ach.caseRecord),
          verifyMcpAuthorityNotOverridden(input.ach, input.expectedAuthority ?? input.ach.survivors)
        ]
      : []),
    ...(input.sourceReview ? createSourceRiskVerificationChecks(input.sourceReview) : []),
    verifyTraceCompleteness(input.trace)
  ];

  const status = checks.every((check) => check.status === "pass") ? "pass" : "fail";
  const residualRisk =
    status === "pass"
      ? [
          "P0/P2 fixture 기반 분석이므로 실제 데이터 연결 전에는 운영 결론으로 승격하지 않는다.",
          ...(input.sourceReview?.flags.map((flag) => `SourceVet ${flag.severity}: ${flag.summary}`) ?? [])
        ]
      : checks.filter((check) => check.status === "fail").map((check) => check.summary);

  return { status, checks, residualRisk };
}

export function verifyAchResultPresent(result: AchAnalysisResult | undefined): VerificationCheck {
  if (!result) {
    return {
      id: "ach-result-present",
      status: "fail",
      summary: "ACH result is missing.",
      failureClass: "missing_analysis_result"
    };
  }
  return { id: "ach-result-present", status: "pass", summary: "ACH result is present." };
}

export function verifyEnoughHypotheses(caseRecord: AchCaseRecord): VerificationCheck {
  if (caseRecord.hypotheses.length < 3) {
    return {
      id: "enough-hypotheses",
      status: "fail",
      summary: "ACH case has fewer than three hypotheses.",
      failureClass: "insufficient_hypotheses"
    };
  }
  return {
    id: "enough-hypotheses",
    status: "pass",
    summary: `ACH case has ${caseRecord.hypotheses.length} hypotheses including null hypothesis.`
  };
}

export function verifyEvidenceReliability(caseRecord: AchCaseRecord): VerificationCheck {
  const invalid = caseRecord.evidence.filter((evidence) => !isValidReliability(evidence.reliability));
  if (invalid.length > 0) {
    return {
      id: "evidence-reliability",
      status: "fail",
      summary: `${invalid.length} evidence record(s) lack valid Admiralty reliability codes.`,
      failureClass: "missing_evidence_reliability"
    };
  }
  return {
    id: "evidence-reliability",
    status: "pass",
    summary: "All evidence records have valid Admiralty reliability codes."
  };
}

export function verifyMatrixComplete(caseRecord: AchCaseRecord): VerificationCheck {
  const expected = caseRecord.hypotheses.length * caseRecord.evidence.length;
  const actual = caseRecord.assessments.length;
  if (actual !== expected) {
    return {
      id: "matrix-complete",
      status: "fail",
      summary: `ACH matrix is incomplete: ${actual}/${expected} cells assessed.`,
      failureClass: "incomplete_matrix"
    };
  }
  return {
    id: "matrix-complete",
    status: "pass",
    summary: `ACH matrix is complete: ${actual}/${expected} cells assessed.`
  };
}

export function verifyMcpAuthorityNotOverridden(result: AchAnalysisResult, expectedSurvivors: string[]): VerificationCheck {
  const expected = [...expectedSurvivors].sort();
  const actual = [...result.survivors].sort();
  if (expected.join("|") !== actual.join("|")) {
    return {
      id: "mcp-authority",
      status: "fail",
      summary: `Authority mismatch. Expected survivors ${expected.join(", ")} but got ${actual.join(", ")}.`,
      failureClass: "model_hallucination"
    };
  }
  return {
    id: "mcp-authority",
    status: "pass",
    summary: "Final authority values match deterministic ACH survivors."
  };
}

export function verifyTraceCompleteness(events: TraceEvent[]): VerificationCheck {
  const requiredPhases = ["run_started", "task_started", "tool_call", "tool_result"];
  const missingPhase = requiredPhases.find((phase) => !events.some((event) => event.phase === phase));
  if (missingPhase) {
    return {
      id: "trace-complete",
      status: "fail",
      summary: `Trace is missing required phase: ${missingPhase}.`,
      failureClass: "trace_gap"
    };
  }

  const writeCalls = events.filter(
    (event) => event.phase === "tool_call" && ["open_case", "add_evidence", "assess"].includes(event.ref ?? "")
  );
  const missingPolicyFor = writeCalls.find((call) => {
    const callIndex = events.indexOf(call);
    return !events
      .slice(0, callIndex)
      .some((event) => event.phase === "policy_decision" && event.ref === call.ref && event.taskId === call.taskId);
  });

  if (missingPolicyFor) {
    return {
      id: "trace-complete",
      status: "fail",
      summary: `WRITE tool call ${missingPolicyFor.ref} has no prior policy decision.`,
      failureClass: "trace_gap"
    };
  }

  return {
    id: "trace-complete",
    status: "pass",
    summary: "Trace includes required phases and policy decisions before WRITE tool calls."
  };
}

export function createSourceRiskVerificationChecks(review: SourceReview): VerificationCheck[] {
  return [
    verifySourceReviewPresent(review),
    verifyIndependentCorroboration(review),
    verifyCircularLineage(review),
    verifySourceLineageKnown(review)
  ];
}

export function verifySourceRiskFlags(review: SourceReview): VerificationCheck {
  if (review.status === "fail") {
    return {
      id: "source-risk-flags",
      status: "fail",
      summary: `SourceVet found high-risk flags: ${review.flags.map((flag) => flag.code).join(", ")}.`,
      failureClass: "sourcevet_high_risk"
    };
  }
  return {
    id: "source-risk-flags",
    status: "pass",
    summary: `SourceVet status ${review.status} with ${review.flags.length} risk flag(s).`
  };
}

function verifySourceReviewPresent(review: SourceReview): VerificationCheck {
  if (review.sourceCount === 0) {
    return {
      id: "sourcevet-review-present",
      status: "fail",
      summary: "SourceVet review has no reviewed KnowledgeUnits.",
      failureClass: "sourcevet_missing_review"
    };
  }
  return {
    id: "sourcevet-review-present",
    status: "pass",
    summary: `SourceVet reviewed ${review.sourceCount} source(s) and ${review.claimCount} claim(s).`
  };
}

function verifyIndependentCorroboration(review: SourceReview): VerificationCheck {
  const uncorroborated = review.flags.filter((flag) => flag.code === "independent-corroboration-required");
  if (uncorroborated.length > 0) {
    return {
      id: "source-independent-corroboration",
      status: "fail",
      summary: uncorroborated.map((flag) => flag.summary).join(" "),
      failureClass: "source_uncorroborated_upgrade"
    };
  }
  return {
    id: "source-independent-corroboration",
    status: "pass",
    summary: `${review.independentCorroboration.corroboratedClaims.length} claim(s) have independent corroboration.`
  };
}

function verifyCircularLineage(review: SourceReview): VerificationCheck {
  const circular = review.flags.filter((flag) => flag.code === "circular-lineage");
  if (circular.length > 0) {
    return {
      id: "source-circular-lineage",
      status: "fail",
      summary: circular.map((flag) => flag.summary).join(" "),
      failureClass: "circular_source_lineage"
    };
  }
  return {
    id: "source-circular-lineage",
    status: "pass",
    summary: "No circular source lineage detected."
  };
}

function verifySourceLineageKnown(review: SourceReview): VerificationCheck {
  const lineageGaps = review.flags.filter((flag) => flag.code === "missing-provenance");
  if (lineageGaps.length > 0) {
    return {
      id: "source-lineage-known",
      status: "fail",
      summary: lineageGaps.map((flag) => flag.summary).join(" "),
      failureClass: "source_lineage_gap"
    };
  }
  return {
    id: "source-lineage-known",
    status: "pass",
    summary: `SourceVet reviewed ${review.sourceAssessments.length} source assessment(s).`
  };
}

export function renderVerificationReport(report: VerificationReport): string {
  return report.checks
    .map((check) => `- [${check.status.toUpperCase()}] ${check.id}: ${check.summary}`)
    .join("\n");
}
