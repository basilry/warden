import type { ApprovalRequest } from "../src/agent/approval.ts";
import type { SourceReview } from "../src/agent/sourcevet-types.ts";
import type {
  AchAnalysisResult,
  AchCaseRecord,
  AuditBrief,
  MatrixCell,
  TeamRun,
  TeamRunResult,
  Verdict,
  VerificationReport
} from "../src/agent/types.ts";
import { assessRuntimeConfidence } from "../src/runtime/confidence-assessment.ts";
import type { RuntimeAnswer, AnswerContext } from "../src/runtime/answer.ts";
import type { RuntimeForecastProducts } from "../src/runtime/analysis-products.ts";
import type { RuntimeRun } from "../src/runtime/types.ts";
import { deriveRuntimeVerdict, deriveRuntimeVerdictFromRun, renderVerdictSummary } from "../src/runtime/verdict.ts";

const blockedRun = makeRun({
  status: "waiting_approval",
  approvals: [pendingApproval("runtime_verdict_blocked")],
  outputs: {
    ach: makeAch("blocked", 3, 1),
    forecast: makeForecast("medium")
  }
});
const blockedVerdict = deriveRuntimeVerdictFromRun(blockedRun);
assertEqual(blockedVerdict.status, "blocked", "blocked verdict status");
assertEqual(blockedVerdict.confidence, "low", "blocked confidence");
assertIncludes(blockedVerdict.blockers.join("\n"), "external_osint_fetch", "blocked approval blocker");

const blockedAssessment = assessRuntimeConfidence(blockedRun);
assertEqual(blockedAssessment.confidence, "low", "blocked assessment confidence");
assertIncludes(blockedAssessment.whyLow.join("\n"), "Pending approvals", "blocked why low");
assertIncludes(blockedAssessment.howToImprove.join("\n"), "approval", "blocked improvement guidance");

const insufficientRun = makeRun({ outputs: {} });
const insufficientVerdict = deriveRuntimeVerdict(insufficientRun);
assertEqual(insufficientVerdict.status, "insufficient_evidence", "insufficient evidence status");
assertIncludes(insufficientVerdict.blockers.join("\n"), "ACH result is missing", "insufficient evidence blocker");

const provisionalRun = makeRun({
  outputs: {
    ach: makeAch("provisional", 2, 2),
    sourceReview: makeSourceReview("review_required"),
    forecast: makeForecast("low")
  }
});
const provisionalVerdict = deriveRuntimeVerdict(provisionalRun);
assertEqual(provisionalVerdict.status, "provisional", "provisional status");
assertIncludes(provisionalVerdict.reasons.join("\n"), "SourceVet status=review_required", "provisional sourcevet reason");

const supportedRun = makeRun({
  outputs: {
    ach: makeAch("supported", 3, 1),
    sourceReview: makeSourceReview("pass"),
    forecast: makeForecast("medium")
  }
});
const supportedVerdict = deriveRuntimeVerdict(supportedRun);
assertEqual(supportedVerdict.status, "supported", "supported status");
assertAtLeast(supportedVerdict.confidenceScore, 0.62, "supported score");

const strongRun = makeRun({
  outputs: {
    ach: makeAch("strong", 6, 1),
    sourceReview: makeSourceReview("pass"),
    forecast: makeForecast("high")
  }
});
const strongVerdict = deriveRuntimeVerdict(strongRun);
assertEqual(strongVerdict.status, "strong", "strong status");
assertEqual(strongVerdict.confidence, "high", "strong confidence");
assertIncludes(renderVerdictSummary(strongVerdict), "강한 판단", "strong summary");

const contextVerdict = deriveRuntimeVerdict(makeAnswerContext(strongRun), strongRun.outputs.answer);
assertEqual(contextVerdict.status, "strong", "answer context overload status");

console.log("WARDEN runtime verdict regression: passed");
console.log(`Blocked: ${renderVerdictSummary(blockedVerdict)} -> ${blockedVerdict.nextAction}`);
console.log(`Insufficient: ${renderVerdictSummary(insufficientVerdict)} -> ${insufficientVerdict.nextAction}`);
console.log(`Provisional: ${renderVerdictSummary(provisionalVerdict)} -> ${provisionalVerdict.nextAction}`);
console.log(`Supported: ${renderVerdictSummary(supportedVerdict)} -> ${supportedVerdict.nextAction}`);
console.log(`Strong: ${renderVerdictSummary(strongVerdict)} -> ${strongVerdict.nextAction}`);

function makeRun(overrides: Partial<RuntimeRun> & { outputs?: Partial<RuntimeRun["outputs"]> }): RuntimeRun {
  const now = "2026-06-18T00:00:00.000Z";
  const base: RuntimeRun = {
    id: "runtime_verdict_fixture",
    objective: "Assess a runtime verdict fixture.",
    status: "succeeded",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    maxIterations: 2,
    iteration: 2,
    withSourceVet: true,
    answerMode: "deterministic",
    events: [],
    modelResponses: [],
    toolResults: [],
    approvals: [],
    outputs: {
      answer: makeAnswer()
    }
  };
  return {
    ...base,
    ...overrides,
    outputs: {
      ...base.outputs,
      ...(overrides.outputs ?? {})
    }
  };
}

function makeAnswerContext(run: RuntimeRun): AnswerContext {
  const ach = requireValue(run.outputs.ach, "ach");
  const sourceReview = requireValue(run.outputs.sourceReview, "sourceReview");
  const teamResult: TeamRunResult = {
    run: makeTeamRun(run),
    trace: [],
    traceSummary: {
      runId: run.id,
      eventCount: 0,
      phases: {},
      policyDecisions: {},
      toolCalls: [],
      failures: []
    },
    outputs: {
      ach,
      verification: makeVerification("pass"),
      sourceReview,
      brief: makeBrief(run.objective)
    }
  };
  return {
    objective: run.objective,
    runStatus: run.status,
    teamResult,
    approvals: run.approvals,
    modelResponses: run.modelResponses,
    forecast: run.outputs.forecast,
    fetchedEvidence: run.outputs.fetchedEvidence
  };
}

function makeTeamRun(run: RuntimeRun): TeamRun {
  return {
    id: `${run.id}_team`,
    objective: run.objective,
    status: "succeeded",
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    tasks: [],
    handoffs: []
  };
}

function makeBrief(objective: string): AuditBrief {
  return {
    title: "Runtime verdict fixture",
    question: objective,
    survivorSummary: "Fixture survivor",
    agentContributions: [],
    verificationSummary: "pass",
    traceSummary: "fixture",
    residualRisk: []
  };
}

function makeAnswer(): RuntimeAnswer {
  return {
    mode: "deterministic",
    title: "Runtime verdict fixture",
    directAnswer: "",
    keyFindings: [],
    evidenceUsed: [],
    uncertainty: [],
    blockedActions: [],
    nextSteps: [],
    authorityRefs: [],
    warnings: []
  };
}

function pendingApproval(runId: string): ApprovalRequest {
  return {
    id: `${runId}_approval`,
    runId,
    action: {
      name: "external_osint_fetch",
      capability: "OSINT collection",
      server: "external",
      risk: "EXTERNAL"
    },
    decision: {
      decision: "require_approval",
      risk: "EXTERNAL",
      reason: "External calls are blocked until human approval."
    },
    requestedBy: "supervisor",
    status: "pending",
    createdAt: "2026-06-18T00:00:00.000Z",
    reason: "External calls are blocked until human approval."
  };
}

function makeAch(id: string, evidenceCount: number, survivorCount: number): AchAnalysisResult {
  const hypotheses = [
    { id: `${id}_h1`, text: "primary hypothesis", isNull: false },
    { id: `${id}_h2`, text: "alternate hypothesis", isNull: false },
    { id: `${id}_h3`, text: "null hypothesis", isNull: true }
  ];
  const evidence = Array.from({ length: evidenceCount }, (_, index) => ({
    id: `${id}_e${index + 1}`,
    text: `Fixture evidence ${index + 1}`,
    source: `fixture://${id}/${index + 1}`,
    reliability: "A1",
    weight: 1
  }));
  const assessments: MatrixCell[] = evidence.flatMap((item, evidenceIndex) =>
    hypotheses.map((hypothesis, hypothesisIndex) => ({
      evidenceId: item.id,
      hypothesisId: hypothesis.id,
      verdict: verdictFor(hypothesisIndex, survivorCount, evidenceIndex)
    }))
  );
  const caseRecord: AchCaseRecord = {
    id: `${id}_case`,
    question: "Fixture ACH question",
    hypotheses,
    evidence,
    assessments
  };
  const ranked = hypotheses
    .map((hypothesis) => {
      const cells = assessments.filter((cell) => cell.hypothesisId === hypothesis.id);
      const contradictions = cells.filter((cell) => cell.verdict === "I").length;
      const support = cells.filter((cell) => cell.verdict === "C").length;
      const neutral = cells.filter((cell) => cell.verdict === "N").length;
      return {
        hypothesisId: hypothesis.id,
        hypothesis: hypothesis.text,
        contradictions,
        support,
        neutral,
        status: "challenged" as const
      };
    })
    .sort((left, right) => left.contradictions - right.contradictions || right.support - left.support);
  const bestContradictions = ranked[0]?.contradictions ?? 0;
  const rankedWithStatus = ranked.map((score) => ({
    ...score,
    status: score.contradictions === bestContradictions ? ("survivor" as const) : ("challenged" as const)
  }));
  return {
    caseId: `${id}_case`,
    question: caseRecord.question,
    matrix: "fixture matrix",
    ranked: rankedWithStatus,
    diagnosticity: evidence.map((item) => ({
      evidenceId: item.id,
      evidence: item.text,
      diagnosticity: 3,
      note: "Fixture evidence distinguishes hypotheses."
    })),
    survivors: rankedWithStatus.filter((score) => score.status === "survivor").map((score) => score.hypothesis),
    rfi: "Collect disconfirming fixture evidence.",
    evidenceBundleIds: evidence.map((item) => `${item.id}_bundle`),
    caseRecord
  };
}

function verdictFor(hypothesisIndex: number, survivorCount: number, evidenceIndex: number): Verdict {
  if (hypothesisIndex < survivorCount) return "C";
  if (hypothesisIndex === 2 && evidenceIndex % 2 === 0) return "N";
  return "I";
}

function makeSourceReview(status: SourceReview["status"]): SourceReview {
  const flags =
    status === "review_required"
      ? [
          {
            code: "independent-corroboration-required" as const,
            severity: "medium" as const,
            summary: "Fixture claim needs another independent source.",
            evidenceRefs: ["fixture_e1"]
          }
        ]
      : [];
  return {
    id: `sourcevet_${status}`,
    status,
    sourceCount: status === "fail" ? 1 : 3,
    reportCount: 0,
    claimCount: 3,
    fabricationRisk: status === "fail" ? 0.8 : 0.05,
    flags,
    sourceAssessments: [],
    independentCorroboration: {
      status: status === "pass" ? "pass" : "fail",
      minIndependentSources: 2,
      requiredClaims: status === "pass" ? [] : [],
      corroboratedClaims: []
    },
    circularLineage: [],
    recommendations: []
  };
}

function makeVerification(status: VerificationReport["status"]): VerificationReport {
  return {
    status,
    checks: [{ id: `fixture_${status}`, status, summary: `Fixture verification ${status}.` }],
    residualRisk: []
  };
}

function makeForecast(confidence: "low" | "medium" | "high"): RuntimeForecastProducts {
  const question = {
    id: `forecast_${confidence}`,
    text: "Fixture forecast question"
  };
  const horizon = {
    label: "next 12 months",
    months: 12,
    startDate: "2026-06-18",
    endDate: "2027-06-18"
  };
  const width = confidence === "high" ? 0.04 : confidence === "medium" ? 0.1 : 0.18;
  return {
    question,
    horizon,
    indicators: [],
    estimate: {
      question,
      horizon,
      baseRate: {
        questionId: question.id,
        horizon,
        horizonMonths: 12,
        referenceClass: "fixture",
        annualProbability: 0.35,
        probability: 0.35,
        probabilityRange: { lower: 0.3, upper: 0.4 },
        confidence,
        rationale: ["Fixture base rate."]
      },
      indicatorAssessment: {
        scores: [],
        netScore: 0,
        supportScore: 0,
        dragScore: 0,
        confidence: confidence === "high" ? 0.8 : confidence === "medium" ? 0.65 : 0.4,
        rationale: ["Fixture indicator assessment."]
      },
      probability: 0.35,
      probabilityRange: { lower: 0.35 - width, upper: 0.35 + width },
      confidenceBand: { lower: 0.35 - width, upper: 0.35 + width, label: confidence, width },
      adjustment: 0,
      rationale: ["Fixture estimate."]
    },
    scenarioSet: {
      questionId: question.id,
      horizon,
      scenarios: [],
      rationale: []
    },
    watchlist: {
      questionId: question.id,
      items: [
        {
          id: `watch_${confidence}`,
          title: "Fixture watch item",
          category: "warning",
          trigger: "Fixture trigger changes.",
          direction: "raises",
          urgency: "monitor",
          linkedIndicatorIds: [],
          rationale: "Fixture watchlist."
        }
      ],
      text: "Fixture trigger changes."
    },
    warnings: []
  };
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`Missing fixture value: ${label}`);
  return value;
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertAtLeast(actual: number, minimum: number, label: string): void {
  if (actual < minimum) {
    throw new Error(`${label} failed: expected >=${minimum} actual=${actual}`);
  }
}
