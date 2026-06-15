import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runP1Workflow } from "./p1-runner.ts";
import { reviewPlannedToolCalls } from "./policy.ts";
import { redactPayload } from "./security/redaction.ts";
import { validateModelOutputAgainstAuthority } from "./security/output-validator.ts";
import { runTeamWorkflow } from "./team-runner.ts";
import type { RegressionCase, RegressionResult, VerificationStatus } from "./types.ts";

export function loadRegressionCases(path: string): RegressionCase[] {
  return readdirSync(path)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(path, file), "utf8")) as RegressionCase);
}

export async function runRegressionCase(regressionCase: RegressionCase): Promise<RegressionResult> {
  if (regressionCase.input.mode === "p1") {
    return runP1RegressionCase(regressionCase);
  }
  if (regressionCase.input.mode === "policy") {
    return runPolicyRegressionCase(regressionCase);
  }
  if (regressionCase.input.mode === "security") {
    return runSecurityRegressionCase(regressionCase);
  }

  const result = await runTeamWorkflow(regressionCase.input.userRequest, {
    fixtureVariant: regressionCase.input.fixtureVariant,
    withSourceVet:
      regressionCase.input.fixtureVariant === "sourcevet_uncorroborated" ||
      regressionCase.input.fixtureVariant === "sourcevet_circular"
  });

  const actualStatus: VerificationStatus =
    result.run.status === "succeeded" && result.outputs.verification?.status === "pass" ? "pass" : "fail";
  const checks = result.outputs.verification?.checks.map((check) => check.id) ?? extractFailureChecks(result);
  const failureClasses = result.outputs.verification?.checks
    .map((check) => check.failureClass)
    .filter((value): value is string => Boolean(value)) ?? extractFailureClasses(result);

  const missingChecks = regressionCase.expected.mustIncludeChecks.filter((check) => !checks.includes(check));
  const missingFailureClass =
    regressionCase.expected.mustIncludeFailureClass && !failureClasses.includes(regressionCase.expected.mustIncludeFailureClass)
      ? regressionCase.expected.mustIncludeFailureClass
      : undefined;

  const passed =
    actualStatus === regressionCase.expected.finalStatus && missingChecks.length === 0 && missingFailureClass === undefined;

  return {
    id: regressionCase.id,
    status: passed ? "passed" : "failed",
    expectedStatus: regressionCase.expected.finalStatus,
    actualStatus,
    checks,
    failureClasses,
    summary: passed
      ? `${regressionCase.id} passed.`
      : `${regressionCase.id} failed. Missing checks=${missingChecks.join(",") || "none"} missingFailureClass=${missingFailureClass ?? "none"}`
  };
}

function runSecurityRegressionCase(regressionCase: RegressionCase): RegressionResult {
  const scenario = regressionCase.input.securityScenario;
  const checks: string[] = [];
  const failureClasses: string[] = [];
  let actualStatus: VerificationStatus = "fail";

  if (scenario === "secret_redaction") {
    const redacted = redactPayload({
      prompt: "use sk-testsecret1234567890 for access",
      Authorization: "Bearer codex_secret1234567890"
    });
    const serialized = JSON.stringify(redacted);
    actualStatus = serialized.includes("sk-testsecret") || serialized.includes("codex_secret") ? "fail" : "pass";
    checks.push("secret-redacted");
    if (actualStatus === "fail") failureClasses.push("secret_logged");
  } else if (scenario === "authority_override") {
    const report = validateModelOutputAgainstAuthority(
      { survivors: ["model-invented-hypothesis"] },
      { achSurvivors: ["supply disruption is customs-related"] }
    );
    actualStatus = report.status === "fail" ? "fail" : "pass";
    checks.push(...report.checks.map((check) => check.id));
    failureClasses.push(
      ...report.checks.map((check) => check.failureClass).filter((value): value is string => Boolean(value))
    );
  } else if (scenario === "raw_tool_call") {
    const report = validateModelOutputAgainstAuthority({ tool_calls: [{ name: "external_fetch" }] }, {});
    actualStatus = report.status === "fail" ? "fail" : "pass";
    checks.push(...report.checks.map((check) => check.id));
    failureClasses.push(
      ...report.checks.map((check) => check.failureClass).filter((value): value is string => Boolean(value))
    );
  }

  const missingChecks = regressionCase.expected.mustIncludeChecks.filter((check) => !checks.includes(check));
  const missingFailureClass =
    regressionCase.expected.mustIncludeFailureClass && !failureClasses.includes(regressionCase.expected.mustIncludeFailureClass)
      ? regressionCase.expected.mustIncludeFailureClass
      : undefined;
  const passed =
    actualStatus === regressionCase.expected.finalStatus && missingChecks.length === 0 && missingFailureClass === undefined;

  return {
    id: regressionCase.id,
    status: passed ? "passed" : "failed",
    expectedStatus: regressionCase.expected.finalStatus,
    actualStatus,
    checks,
    failureClasses,
    summary: passed
      ? `${regressionCase.id} passed.`
      : `${regressionCase.id} failed. Missing checks=${missingChecks.join(",") || "none"} missingFailureClass=${missingFailureClass ?? "none"}`
  };
}

async function runP1RegressionCase(regressionCase: RegressionCase): Promise<RegressionResult> {
  const result = await runP1Workflow(regressionCase.input.userRequest);
  const actualStatus: VerificationStatus =
    result.job.status === "succeeded" && result.p0Result.run.status === "succeeded" ? "pass" : "fail";
  const checks = [
    ...(result.pendingApprovals.length > 0 ? ["approval-pending"] : []),
    ...(result.p0Result.run.status === "succeeded" ? ["p0-team-succeeded"] : []),
    ...(result.knowledgeSummary.includes("ku_") ? ["knowledge-ingested"] : [])
  ];
  const missingChecks = regressionCase.expected.mustIncludeChecks.filter((check) => !checks.includes(check));
  const passed = actualStatus === regressionCase.expected.finalStatus && missingChecks.length === 0;

  return {
    id: regressionCase.id,
    status: passed ? "passed" : "failed",
    expectedStatus: regressionCase.expected.finalStatus,
    actualStatus,
    checks,
    failureClasses: [],
    summary: passed ? `${regressionCase.id} passed.` : `${regressionCase.id} failed. Missing checks=${missingChecks.join(",")}`
  };
}

function runPolicyRegressionCase(regressionCase: RegressionCase): RegressionResult {
  const report = reviewPlannedToolCalls(regressionCase.input.policyCalls ?? [], {
    runId: `reg_${regressionCase.id}`,
    role: "policy_reviewer",
    availableCapabilities: regressionCase.input.availableCapabilities
  });
  const actualStatus: VerificationStatus = report.status === "allow" ? "pass" : "fail";
  const checks = [
    ...(report.status === "allow" ? ["policy-review-allowed"] : []),
    ...(report.status === "approval_required" ? ["policy-approval-required"] : []),
    ...(report.status === "blocked" ? ["policy-blocked"] : []),
    ...report.decisions.map((decision) => `policy-${decision.risk.toLowerCase()}-${decision.decision}`)
  ];
  const failureClasses = [
    ...report.decisions
      .filter((decision) => decision.decision === "require_approval" && decision.risk === "EXTERNAL")
      .map(() => "external_approval_required"),
    ...report.decisions
      .filter((decision) => decision.decision === "deny" && decision.risk === "POLICY_CHANGE")
      .map(() => "policy_change_denied"),
    ...report.decisions.filter((decision) => decision.decision === "deny").map(() => "policy_review_denied")
  ];
  if (failureClasses.includes("policy_change_denied")) checks.push("policy-change-denied");

  const missingChecks = regressionCase.expected.mustIncludeChecks.filter((check) => !checks.includes(check));
  const missingFailureClass =
    regressionCase.expected.mustIncludeFailureClass && !failureClasses.includes(regressionCase.expected.mustIncludeFailureClass)
      ? regressionCase.expected.mustIncludeFailureClass
      : undefined;
  const passed =
    actualStatus === regressionCase.expected.finalStatus && missingChecks.length === 0 && missingFailureClass === undefined;

  return {
    id: regressionCase.id,
    status: passed ? "passed" : "failed",
    expectedStatus: regressionCase.expected.finalStatus,
    actualStatus,
    checks,
    failureClasses,
    summary: passed
      ? `${regressionCase.id} passed.`
      : `${regressionCase.id} failed. Missing checks=${missingChecks.join(",") || "none"} missingFailureClass=${missingFailureClass ?? "none"}`
  };
}

export async function runRegressionSuite(cases: RegressionCase[]): Promise<RegressionResult[]> {
  const results: RegressionResult[] = [];
  for (const regressionCase of cases) {
    results.push(await runRegressionCase(regressionCase));
  }
  return results;
}

export function renderRegressionSummary(results: RegressionResult[]): string {
  const passed = results.filter((result) => result.status === "passed").length;
  const lines = [
    `Regression summary: ${passed}/${results.length} passed`,
    ...results.map(
      (result) =>
        `- [${result.status.toUpperCase()}] ${result.id}: expected=${result.expectedStatus}, actual=${result.actualStatus}, checks=${result.checks.join(",") || "none"}`
    )
  ];
  return lines.join("\n");
}

export function assertRegressionResults(results: RegressionResult[]): void {
  const failed = results.filter((result) => result.status === "failed");
  if (failed.length > 0) {
    throw new Error(renderRegressionSummary(results));
  }
}

export function createBuiltInNormalRegressionCase(): RegressionCase {
  return {
    id: "WARDEN-001-normal-supply-chain",
    title: "Normal supply-chain workflow passes verification",
    input: {
      userRequest: "가상 방산 공급망 핵심 부품 수입 급감의 원인을 분석해줘.",
      fixtureVariant: "normal"
    },
    expected: {
      finalStatus: "pass",
      mustIncludeChecks: ["ach-result-present", "enough-hypotheses", "evidence-reliability", "matrix-complete", "mcp-authority", "trace-complete"]
    },
    lockedReason: "P0 happy path must preserve deterministic analysis, policy trace, verification, and briefing."
  };
}

function extractFailureChecks(result: Awaited<ReturnType<typeof runTeamWorkflow>>): string[] {
  const summaries = result.trace.map((event) => event.summary).join("\n");
  if (summaries.includes("Admiralty reliability code")) return ["evidence-reliability"];
  if (summaries.includes("no prior policy decision")) return ["trace-complete"];
  return ["run-failed"];
}

function extractFailureClasses(result: Awaited<ReturnType<typeof runTeamWorkflow>>): string[] {
  const summaries = result.trace.map((event) => event.summary).join("\n");
  if (summaries.includes("Admiralty reliability code")) return ["missing_evidence_reliability"];
  if (summaries.includes("no prior policy decision")) return ["trace_gap"];
  return ["run_failed"];
}
