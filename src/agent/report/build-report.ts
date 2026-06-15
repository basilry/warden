import { newId, nowIso } from "../ids.ts";
import type { P1RunResult } from "../p1-runner.ts";
import type { AchAnalysisResult, RegressionResult, TeamRunResult, TraceEvent } from "../types.ts";
import type {
  AchPanel,
  ApprovalPanel,
  CasePanel,
  JobPanel,
  PolicyPanel,
  RegressionPanel,
  ReportStatus,
  SourceVetPanel,
  TracePanel,
  WardenReport,
  WardenReportInput
} from "./types.ts";

export function buildWardenReport(input: WardenReportInput): WardenReport {
  const status = resolveReportStatus(input.teamResult, input.p1Result);
  return {
    reportId: newId("report"),
    runId: input.teamResult.run.id,
    generatedAt: input.generatedAt ?? nowIso(),
    title: "WARDEN Audit Report",
    status,
    casePanel: buildCasePanel(input.teamResult),
    jobPanel: input.p1Result ? buildJobPanel(input.p1Result) : undefined,
    achPanel: buildAchPanel(input.teamResult.outputs.ach),
    sourceVetPanel: input.teamResult.outputs.sourceReview ? buildSourceVetPanel(input.teamResult.outputs.sourceReview) : undefined,
    policyPanel: buildPolicyPanel(input.teamResult),
    approvalPanel: buildApprovalPanel(input.p1Result),
    tracePanel: buildTracePanel(input.teamResult),
    regressionPanel: input.regressionResults ? buildRegressionPanel(input.regressionResults) : undefined,
    residualRisk: input.teamResult.outputs.verification?.residualRisk ?? []
  };
}

export function buildCasePanel(result: TeamRunResult): CasePanel {
  return {
    runId: result.run.id,
    objective: result.run.objective,
    runStatus: result.run.status,
    createdAt: result.run.createdAt,
    completedAt: result.run.completedAt,
    question: result.outputs.ach?.question ?? result.outputs.caseFrame?.question,
    verificationStatus: result.outputs.verification?.status
  };
}

export function buildAchPanel(result?: AchAnalysisResult): AchPanel {
  return {
    caseId: result?.caseId,
    survivors: result?.survivors ?? [],
    ranking:
      result?.ranked.map((score) => ({
        hypothesis: score.hypothesis,
        contradictions: score.contradictions,
        support: score.support,
        neutral: score.neutral,
        status: score.status
      })) ?? [],
    diagnosticity:
      result?.diagnosticity.map((score) => ({
        evidence: score.evidence,
        diagnosticity: score.diagnosticity,
        note: score.note
      })) ?? [],
    matrixRows: result ? parseMatrix(result.matrix) : [],
    rfi: result?.rfi
  };
}

export function buildSourceVetPanel(review: NonNullable<TeamRunResult["outputs"]["sourceReview"]>): SourceVetPanel {
  return {
    status: review.status,
    sourceCount: review.sourceCount,
    claimCount: review.claimCount,
    fabricationRisk: review.fabricationRisk,
    flags: review.flags.map((flag) => ({
      code: flag.code,
      severity: flag.severity,
      summary: flag.summary,
      sourceId: flag.sourceId
    })),
    recommendations: [...review.recommendations]
  };
}

export function buildPolicyPanel(result: TeamRunResult): PolicyPanel {
  const decisions = result.trace
    .filter((event) => event.phase === "policy_decision")
    .map((event) => ({
      ref: event.ref,
      summary: event.summary,
      ts: event.ts
    }));
  return {
    status: result.outputs.policyReview?.status,
    summary: result.outputs.policyReview?.summary,
    decisions,
    counts: result.traceSummary.policyDecisions
  };
}

export function buildApprovalPanel(p1Result?: P1RunResult): ApprovalPanel {
  return {
    pendingCount: p1Result?.pendingApprovals.length ?? 0,
    approvals: p1Result?.pendingApprovals ?? []
  };
}

export function buildTracePanel(result: TeamRunResult): TracePanel {
  return {
    eventCount: result.traceSummary.eventCount,
    toolCalls: result.traceSummary.toolCalls,
    failures: result.traceSummary.failures,
    events: result.trace
  };
}

export function buildRegressionPanel(results: RegressionResult[]): RegressionPanel {
  return {
    total: results.length,
    passed: results.filter((result) => result.status === "passed").length,
    results
  };
}

export function createReportInputFromTeamRun(result: TeamRunResult): WardenReportInput {
  return { teamResult: result };
}

export function createReportInputFromP1Run(p1Result: P1RunResult, teamResult = p1Result.p0Result): WardenReportInput {
  return { teamResult, p1Result };
}

function resolveReportStatus(teamResult: TeamRunResult, p1Result?: P1RunResult): ReportStatus {
  if (teamResult.run.status === "blocked") return "blocked";
  if (teamResult.run.status !== "succeeded" || teamResult.outputs.verification?.status === "fail") return "fail";
  if ((p1Result?.pendingApprovals.length ?? 0) > 0 || teamResult.outputs.sourceReview?.flags.length) return "warn";
  return "pass";
}

function buildJobPanel(result: P1RunResult): JobPanel {
  return {
    jobId: result.job.jobId,
    status: result.job.status,
    history: result.job.history.map((item) => ({
      status: item.status,
      summary: item.summary,
      ref: item.ref,
      at: item.ts
    })),
    toolCatalog: splitLines(result.toolCatalog),
    knowledgeSummary: splitLines(result.knowledgeSummary)
  };
}

function parseMatrix(matrix: string): string[][] {
  return matrix
    .split("\n")
    .filter((line) => !/^[-| ]+$/.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()));
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
