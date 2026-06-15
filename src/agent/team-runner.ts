import { createTraceRecorder } from "./audit.ts";
import { renderAuditBriefMarkdown } from "./brief.ts";
import { newId, nowIso } from "./ids.ts";
import { createPolicyEngine } from "./policy.ts";
import { writeRunArtifacts } from "./run-store.ts";
import { createAchAnalystAgent } from "./agents/ach-analyst.ts";
import { runAgentTask } from "./agents/base.ts";
import { createBriefingAgent } from "./agents/briefing.ts";
import { createCaseFramerAgent } from "./agents/case-framer.ts";
import { createEvidenceCuratorAgent } from "./agents/evidence-curator.ts";
import { createPolicyReviewerAgent } from "./agents/policy-reviewer.ts";
import { createSourceVetReviewerAgent } from "./agents/sourcevet-reviewer.ts";
import { createSupervisorAgent } from "./agents/supervisor.ts";
import { createVerificationAgent } from "./agents/verifier.ts";
import type { SourceReview } from "./sourcevet-types.ts";
import type {
  AchAnalysisResult,
  AgentContext,
  AgentRole,
  AgentTask,
  AuditBrief,
  CaseFrame,
  EvidenceBundle,
  KnowledgeUnit,
  PolicyReviewReport,
  RunOptions,
  TeamPlan,
  TeamRun,
  TeamRunResult,
  ToolCallPlan,
  VerificationReport
} from "./types.ts";

const DEFAULT_REQUEST = "가상 방산 공급망 핵심 부품 수입 급감의 원인을 분석하고 생존 가설과 RFI를 제안해줘.";

export async function runTeamWorkflow(userRequest = DEFAULT_REQUEST, options: RunOptions = {}): Promise<TeamRunResult> {
  const runId = newId("run");
  const trace = createTraceRecorder(runId);
  const policy = createPolicyEngine();
  const context: AgentContext = { runId, trace, policy, options };

  const run: TeamRun = {
    id: runId,
    objective: userRequest,
    status: "running",
    createdAt: nowIso(),
    tasks: [],
    handoffs: []
  };

  const outputs: TeamRunResult["outputs"] = {};

  trace.record({
    phase: "run_started",
    actor: "system",
    summary: `WARDEN team run started: ${userRequest}`,
    payload: { userRequest, options }
  });

  const supervisorTask = createAgentTask(runId, "supervisor", "Plan WARDEN P0 specialist workflow.", userRequest);
  run.tasks.push(supervisorTask);
  trace.record({ phase: "task_created", actor: "system", taskId: supervisorTask.id, summary: supervisorTask.goal });
  const supervisorResult = await runAgentTask(createSupervisorAgent(), supervisorTask, context, userRequest);
  if (supervisorResult.status !== "succeeded") {
    return finishFailedRun(run, context, outputs, supervisorResult.summary);
  }

  const withSourceVet = shouldRunSourceVet(options);
  const plan = buildFixedPlan(runId, userRequest, { withSourceVet });
  run.tasks.push(...plan.tasks);
  for (const task of plan.tasks) {
    trace.record({ phase: "task_created", actor: "system", taskId: task.id, summary: task.goal, payload: task });
  }

  const caseTask = plan.tasks.find((task) => task.role === "case_framer");
  if (!caseTask) return finishFailedRun(run, context, outputs, "Case Framer task missing.");
  const caseResult = await runAgentTask(createCaseFramerAgent(), caseTask, context, userRequest);
  if (caseResult.status !== "succeeded" || !caseResult.output) {
    return finishFailedRun(run, context, outputs, caseResult.summary);
  }
  outputs.caseFrame = caseResult.output as CaseFrame;
  run.handoffs.push(...(caseResult.handoffs ?? []));

  const curatorTask = plan.tasks.find((task) => task.role === "evidence_curator");
  if (!curatorTask) return finishFailedRun(run, context, outputs, "Evidence Curator task missing.");
  const curatorResult = await runAgentTask(createEvidenceCuratorAgent(), curatorTask, context, outputs.caseFrame);
  if (curatorResult.status !== "succeeded" || !curatorResult.output) {
    return finishFailedRun(run, context, outputs, curatorResult.summary);
  }
  const curatorOutput = curatorResult.output as { units: KnowledgeUnit[]; bundles: EvidenceBundle[] };
  outputs.knowledgeUnits = curatorOutput.units;
  outputs.evidenceBundles = curatorOutput.bundles;
  run.handoffs.push(...(curatorResult.handoffs ?? []));

  const policyTask = plan.tasks.find((task) => task.role === "policy_reviewer");
  if (!policyTask) return finishFailedRun(run, context, outputs, "Policy Reviewer task missing.");
  const policyResult = await runAgentTask(createPolicyReviewerAgent(), policyTask, context, {
    calls: buildPlannedToolCalls(withSourceVet),
    availableCapabilities: ["Hypothesis Analysis", "Source Reliability Review"]
  });
  outputs.policyReview = policyResult.output as PolicyReviewReport | undefined;
  run.handoffs.push(...(policyResult.handoffs ?? []));
  if (policyResult.status !== "succeeded" || outputs.policyReview?.status !== "allow") {
    return finishFailedRun(run, context, outputs, policyResult.summary);
  }

  if (withSourceVet) {
    const sourceVetTask = plan.tasks.find((task) => task.role === "sourcevet_reviewer");
    if (!sourceVetTask) return finishFailedRun(run, context, outputs, "SourceVet Reviewer task missing.");
    const sourceVetResult = await runAgentTask(createSourceVetReviewerAgent(), sourceVetTask, context, {
      units: outputs.knowledgeUnits,
      scenarioId: options.fixtureVariant
    });
    if (sourceVetResult.status !== "succeeded" || !sourceVetResult.output) {
      return finishFailedRun(run, context, outputs, sourceVetResult.summary);
    }
    outputs.sourceReview = sourceVetResult.output as SourceReview;
    run.handoffs.push(...(sourceVetResult.handoffs ?? []));
  }

  const achTask = plan.tasks.find((task) => task.role === "ach_analyst");
  if (!achTask) return finishFailedRun(run, context, outputs, "ACH Analyst task missing.");
  const achResult = await runAgentTask(createAchAnalystAgent(), achTask, context, {
    frame: outputs.caseFrame,
    bundles: outputs.evidenceBundles
  });
  if (achResult.status !== "succeeded" || !achResult.output) {
    return finishFailedRun(run, context, outputs, achResult.summary);
  }
  outputs.ach = achResult.output as AchAnalysisResult;
  run.handoffs.push(...(achResult.handoffs ?? []));

  const verificationTask = plan.tasks.find((task) => task.role === "verifier");
  if (!verificationTask) return finishFailedRun(run, context, outputs, "Verifier task missing.");
  const verificationResult = await runAgentTask(createVerificationAgent(), verificationTask, context, {
    ach: outputs.ach,
    sourceReview: outputs.sourceReview
  });
  outputs.verification = verificationResult.output as VerificationReport | undefined;
  run.handoffs.push(...(verificationResult.handoffs ?? []));
  if (verificationResult.status !== "succeeded" || outputs.verification?.status !== "pass") {
    return finishFailedRun(run, context, outputs, verificationResult.summary);
  }

  const briefingTask = plan.tasks.find((task) => task.role === "briefing");
  if (!briefingTask) return finishFailedRun(run, context, outputs, "Briefing task missing.");
  const briefingResult = await runAgentTask(createBriefingAgent(), briefingTask, context, {
    ach: outputs.ach,
    verification: outputs.verification,
    sourceReview: outputs.sourceReview,
    policyReview: outputs.policyReview
  });
  if (briefingResult.status !== "succeeded" || !briefingResult.output) {
    return finishFailedRun(run, context, outputs, briefingResult.summary);
  }
  outputs.brief = briefingResult.output as AuditBrief;

  run.status = "succeeded";
  run.completedAt = nowIso();
  trace.record({
    phase: "run_finished",
    actor: "system",
    summary: "WARDEN team run succeeded.",
    payload: { runStatus: run.status }
  });

  const result = buildResult(run, context, outputs);
  if (options.writeArtifacts) writeRunArtifacts(result, options.artifactDir);
  return result;
}

export function buildFixedPlan(runId: string, objective: string, options: { withSourceVet?: boolean } = {}): TeamPlan {
  const roles: { role: AgentRole; goal: string; dependsOn: string[] }[] = [
    { role: "case_framer", goal: "Convert the user request into an ACH case frame.", dependsOn: [] },
    { role: "evidence_curator", goal: "Normalize fixture evidence into KnowledgeUnits and EvidenceBundles.", dependsOn: ["case_framer"] },
    { role: "policy_reviewer", goal: "Review planned tool calls before specialist execution.", dependsOn: ["evidence_curator"] },
    ...(options.withSourceVet
      ? [
          {
            role: "sourcevet_reviewer" as const,
            goal: "Review source reliability and lineage before ACH promotion.",
            dependsOn: ["evidence_curator", "policy_reviewer"]
          }
        ]
      : []),
    {
      role: "ach_analyst",
      goal: "Execute deterministic ACH analysis through policy-gated local tools.",
      dependsOn: options.withSourceVet ? ["sourcevet_reviewer", "policy_reviewer"] : ["policy_reviewer"]
    },
    { role: "verifier", goal: "Independently verify ACH output, source risk, policy trace, and matrix completeness.", dependsOn: ["ach_analyst"] },
    { role: "briefing", goal: "Create an audit brief only after verification passes.", dependsOn: ["verifier"] }
  ];

  return {
    runId,
    objective,
    tasks: roles.map((item) => createAgentTask(runId, item.role, item.goal, { objective }, item.dependsOn))
  };
}

export function createAgentTask(
  runId: string,
  role: AgentRole,
  goal: string,
  input: unknown,
  dependsOn: string[] = []
): AgentTask {
  return {
    id: newId("task"),
    runId,
    role,
    goal,
    input,
    status: "queued",
    dependsOn,
    createdAt: nowIso()
  };
}

function finishFailedRun(
  run: TeamRun,
  context: AgentContext,
  outputs: TeamRunResult["outputs"],
  reason: string
): TeamRunResult {
  run.status = "failed";
  run.completedAt = nowIso();
  context.trace.record({
    phase: "run_finished",
    actor: "system",
    summary: `WARDEN team run failed: ${reason}`,
    payload: { runStatus: run.status, reason }
  });
  return buildResult(run, context, outputs);
}

function buildResult(run: TeamRun, context: AgentContext, outputs: TeamRunResult["outputs"]): TeamRunResult {
  const trace = context.trace.getEvents();
  const traceSummary = context.trace.summarize();
  if (outputs.brief) {
    outputs.brief = {
      ...outputs.brief,
      traceSummary: `${traceSummary.eventCount} trace events, ${traceSummary.toolCalls.length} tool calls, policy decisions: ${JSON.stringify(traceSummary.policyDecisions)}`
    };
  }
  const markdown =
    outputs.brief && outputs.ach && outputs.verification
      ? renderAuditBriefMarkdown(outputs.brief, {
          ach: outputs.ach,
          verification: outputs.verification,
          sourceReview: outputs.sourceReview
        })
      : undefined;

  return {
    run,
    trace,
    traceSummary,
    outputs,
    markdown
  };
}

function shouldRunSourceVet(options: RunOptions): boolean {
  return (
    options.withSourceVet === true ||
    options.fixtureVariant === "sourcevet_uncorroborated" ||
    options.fixtureVariant === "sourcevet_circular"
  );
}

function buildPlannedToolCalls(withSourceVet: boolean): ToolCallPlan[] {
  const calls: ToolCallPlan[] = [
    createToolCallPlan("open_case", "Hypothesis Analysis", "WRITE", "Open deterministic ACH case.", "ach_analyst"),
    createToolCallPlan("add_evidence", "Hypothesis Analysis", "WRITE", "Promote curated bundles into ACH evidence.", "ach_analyst"),
    createToolCallPlan("assess", "Hypothesis Analysis", "WRITE", "Assess evidence against hypotheses.", "ach_analyst"),
    createToolCallPlan("rank_hypotheses", "Hypothesis Analysis", "READ", "Rank deterministic ACH hypotheses.", "ach_analyst")
  ];
  if (withSourceVet) {
    calls.unshift(
      createToolCallPlan(
        "review_sources",
        "Source Reliability Review",
        "WRITE",
        "Review source reliability and lineage before ACH analysis.",
        "sourcevet_reviewer"
      )
    );
  }
  return calls;
}

function createToolCallPlan(
  toolName: string,
  capability: string,
  risk: ToolCallPlan["risk"],
  inputSummary: string,
  requestedBy: AgentRole
): ToolCallPlan {
  return {
    id: newId("tcp"),
    toolName,
    capability,
    risk,
    inputSummary,
    requestedBy
  };
}
