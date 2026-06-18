import { createApprovalQueue } from "../agent/approval.ts";
import { createTraceRecorder } from "../agent/audit.ts";
import { loadWardenConfig, type WardenConfig } from "../agent/config.ts";
import { newId, nowIso } from "../agent/ids.ts";
import { createModelRequest, type ModelAdapter, type ModelResponse } from "../agent/model-adapter.ts";
import { createModelAdapterFromConfig } from "../agent/models/provider.ts";
import { createLocalCapabilityRegistry } from "../agent/mcp/local-registry.ts";
import type { OsintSearchMcpInvoker } from "../agent/mcp/osint-client.ts";
import { routeToolCallWithPolicy } from "../agent/mcp/router.ts";
import { createStdioMcpClient } from "../agent/mcp/stdio-client.ts";
import { loadMcpRegistryConfig } from "../agent/mcp/config.ts";
import type { CapabilityRouter, McpClient } from "../agent/mcp/types.ts";
import type { OsintFetchLike } from "../connectors/osint/http-client.ts";
import { retrieveSupplyChainGrounding } from "../agent/knowledge/retrieval.ts";
import { createPolicyEngine } from "../agent/policy.ts";
import { runTeamWorkflow } from "../agent/team-runner.ts";
import type { TeamRunResult } from "../agent/types.ts";
import { approvePendingApproval, rejectPendingApproval } from "./approval-actions.ts";
import {
  composeDeterministicAnswer,
  composeModelAssistedAnswerFromResponse,
  createAnswerDraftRequest,
  type AnswerContext,
  type RuntimeAnswer,
  type RuntimeAnswerMode
} from "./answer.ts";
import { buildRuntimeAnalysisProducts } from "./analysis-products.ts";
import { EXTERNAL_OSINT_FETCH_TOOL } from "./external-fetch.ts";
import { buildInvestigationPlan } from "./investigation-planner.ts";
import { buildDeterministicRuntimeToolPlan, selectRuntimeToolPlan } from "./planner.ts";
import { composeSecurityReport } from "./report-composer.ts";
import { resumeApprovedExternalFetchRun } from "./resume.ts";
import {
  appendRuntimeEvent,
  attachRuntimeRepository,
  getRuntimeRepository,
  saveRuntimeRun,
  type RuntimeRepository
} from "./storage.ts";
import type {
  RuntimeDomainGrounding,
  RuntimeEvent,
  RuntimeRun,
  RuntimeRunRequest,
  RuntimeState,
  RuntimeToolRecord
} from "./types.ts";

const DEFAULT_OBJECTIVE =
  "가상 방산 공급망 핵심 부품 수입 급감의 원인을 분석하고 통제 가능한 에이전트 루프로 처리해줘.";

export type RuntimeDependencies = {
  config?: WardenConfig;
  model?: ModelAdapter;
  remotes?: McpClient[];
  repository?: RuntimeRepository;
  osintFetchImpl?: OsintFetchLike;
  osintSearchInvoker?: OsintSearchMcpInvoker;
  onEvent?: (event: RuntimeEvent, run: RuntimeRun) => void;
};

export type RuntimeApprovalCommand = {
  approvalId?: string;
  toolName?: string;
  actor?: string;
  reason?: string;
};

export function createRuntimeState(repository?: RuntimeRepository): RuntimeState {
  const state: RuntimeState = { runs: new Map() };
  return repository ? attachRuntimeRepository(state, repository) : state;
}

export function startRuntimeRun(
  state: RuntimeState,
  request: RuntimeRunRequest,
  deps: RuntimeDependencies = {}
): RuntimeRun {
  const runtimeDeps = withStateRepository(state, deps);
  const now = nowIso();
  const run: RuntimeRun = {
    id: newId("runtime"),
    objective: request.objective?.trim() || DEFAULT_OBJECTIVE,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    maxIterations: Math.max(1, Math.min(request.maxIterations ?? 2, 8)),
    iteration: 0,
    withSourceVet: request.withSourceVet === true,
    answerMode: request.answerMode ?? resolveDefaultAnswerMode(),
    events: [],
    modelResponses: [],
    toolResults: [],
    approvals: [],
    outputs: {}
  };
  state.runs.set(run.id, run);
  emit(run, "run.created", "런타임 실행이 대기열에 등록되었습니다.", { objective: run.objective }, runtimeDeps);
  void executeRuntimeRun(run, runtimeDeps);
  return run;
}

export function getRuntimeRun(state: RuntimeState, runId: string): RuntimeRun | undefined {
  return state.runs.get(runId);
}

export function listRuntimeRuns(state: RuntimeState): RuntimeRun[] {
  return [...state.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function executeRuntimeRun(run: RuntimeRun, deps: RuntimeDependencies = {}): Promise<void> {
  const config = deps.config ?? loadWardenConfig();
  const model = deps.model ?? createModelAdapterFromConfig(config.model);
  const approvals = createApprovalQueue();
  const policy = createPolicyEngine();
  const trace = createTraceRecorder(run.id);
  let latestTeamResult: TeamRunResult | undefined;
  let latestPlannerProposal = undefined as Awaited<ReturnType<ModelAdapter["generate"]>> | undefined;

  run.status = "running";
  touch(run);
  emit(run, "run.started", `모델 ${model.id}로 런타임 루프를 시작했습니다.`, { model: model.id }, deps);

  try {
    attachDomainGrounding(run, deps);
    const investigationModelResponse = await requestInvestigationPlanProposal(run, model, deps);
    if (investigationModelResponse) {
      run.modelResponses.push(investigationModelResponse);
    }
    const investigationPlan = buildInvestigationPlan(run.objective, investigationModelResponse, {
      currentDate: new Date().toISOString().slice(0, 10),
      language: "ko"
    });
    run.outputs.investigationPlan = investigationPlan;
    emit(
      run,
      "investigation.plan",
      "질문별 분석계획을 생성했습니다.",
      {
        source: investigationPlan.source,
        warnings: investigationPlan.warnings,
        domain: investigationPlan.domain,
        scenario: investigationPlan.classification.scenario,
        matchedSignals: investigationPlan.classification.matchedSignals,
        hypothesisCount: investigationPlan.hypotheses.length,
        searchPlanCount: investigationPlan.searchPlan.length
      },
      deps
    );
    attachRuntimeAnalysisProducts(run, undefined, deps);

    const router = createRuntimeRouter(run.objective, deps, {
      withSourceVet: run.withSourceVet,
      investigationPlan
    });
    const preflightedExternalApproval = await preflightExternalOsintApproval(run, {
      approvals,
      deps,
      policy,
      router,
      trace
    });
    if (preflightedExternalApproval) {
      run.completedAt = nowIso();
      touch(run);
      emit(run, "approval.pending", `런타임 실행 상태: ${formatRunStatusKo(run.status)}.`, undefined, deps);
      return;
    }

    for (let index = 1; index <= run.maxIterations; index += 1) {
      run.iteration = index;
      touch(run);
      emit(run, "loop.iteration", `반복 ${index}/${run.maxIterations}.`, undefined, deps);

      if (shouldRequestModelProposal(index)) {
        const modelRequest = createModelRequest({
          role: "planner",
          prompt: buildRuntimePrompt(run, index),
          context: summarizeRunForModel(run),
          responseFormat: "json"
        });
        emit(
          run,
          "model.requested",
          `${model.id}에 계획 제안을 요청합니다.`,
          { model: model.id, role: modelRequest.role, iteration: index },
          deps
        );
        const modelStartedAt = Date.now();
        const proposal = await model.generate(modelRequest);
        const modelDurationMs = Date.now() - modelStartedAt;
        run.modelResponses.push(proposal);
        latestPlannerProposal = proposal;
        emit(
          run,
          "model.proposal",
          `${proposal.model}에서 모델 제안을 받았습니다.`,
          { warnings: proposal.warnings, model: proposal.model, durationMs: modelDurationMs },
          deps
        );
      }

      const selection = selectRuntimeToolPlan({
        run,
        iteration: index,
        proposal: index === 1 ? latestPlannerProposal : undefined,
        allowlist: router.allowlist,
        allowedCapabilities: ["Hypothesis Analysis", "RFI Watch"]
      });
      const plan = selection.selected;
      emit(
        run,
        "mcp.tool_start",
        `${plan.toolName}을 정책 검토와 MCP 라우터로 전달합니다.`,
        {
          toolName: plan.toolName,
          capability: plan.capability,
          risk: plan.risk,
          plannerSource: selection.source,
          plannerWarnings: selection.warnings
        },
        deps
      );
      const toolStartedAt = Date.now();
      const result = await routeToolCallWithPolicy(plan, router, {
        runId: run.id,
        role: "supervisor",
        policy,
        approvals,
        trace
      });
      const toolDurationMs = Date.now() - toolStartedAt;
      run.toolResults.push(toToolRecord(index, plan.toolName, result, toolDurationMs));
      emit(
        run,
        "mcp.tool_call",
        `${plan.toolName}: ${formatToolStatusKo(result.status)}.`,
        { decision: result.decision, error: result.error, durationMs: toolDurationMs },
        deps
      );

      if (result.approvalRequest) {
        run.approvals = approvals.listAll();
        run.status = "waiting_approval";
        updateRuntimeAnswer(run, latestTeamResult);
        touch(run);
        emit(run, "approval.pending", `${plan.toolName} 승인 대기 중입니다.`, result.approvalRequest, deps);
        break;
      }

      if (result.output && isTeamRunResult(result.output)) {
        latestTeamResult = result.output;
        run.outputs = {
          teamRunId: result.output.run.id,
          teamStatus: result.output.run.status,
          survivors: result.output.outputs.ach?.survivors,
          traceEvents: result.output.trace.length,
          domainGrounding: run.outputs.domainGrounding,
          domainExpansion: run.outputs.domainExpansion,
          ragContext: run.outputs.ragContext,
          claimGraph: run.outputs.claimGraph,
          evidenceLedger: run.outputs.evidenceLedger,
          forecast: run.outputs.forecast,
          investigationPlan: run.outputs.investigationPlan,
          fetchedEvidence: run.outputs.fetchedEvidence,
          caseFrame: result.output.outputs.caseFrame,
          knowledgeUnits: result.output.outputs.knowledgeUnits,
          evidenceBundles: result.output.outputs.evidenceBundles,
          ach: result.output.outputs.ach,
          sourceReview: result.output.outputs.sourceReview
        };
        refreshRuntimeDerivedOutputs(run, latestTeamResult);
      }
    }

    if (run.status !== "waiting_approval") {
      run.status = "succeeded";
    }
    await finalizeRuntimeAnswer(run, latestTeamResult, model, deps);
    run.completedAt = nowIso();
    touch(run);
    emit(
      run,
      run.status === "succeeded" ? "run.succeeded" : "approval.pending",
      `런타임 실행 상태: ${formatRunStatusKo(run.status)}.`,
      undefined,
      deps
    );
  } catch (error) {
    run.status = "failed";
    run.error = (error as Error).message;
    run.completedAt = nowIso();
    touch(run);
    emit(run, "run.failed", run.error, undefined, deps);
  }
}

export async function approveRuntimeApproval(
  state: RuntimeState,
  runId: string,
  input: RuntimeApprovalCommand,
  deps: RuntimeDependencies = {}
): Promise<RuntimeRun> {
  const runtimeDeps = withStateRepository(state, deps);
  const config = runtimeDeps.config ?? loadWardenConfig();
  const run = requireRun(state, runId);
  const resolved = approvePendingApproval(run, {
    approvalId: input.approvalId,
    toolName: input.toolName,
    actor: input.actor ?? "operator",
    reason: input.reason
  });
  let nextRun = resolved.run;
  state.runs.set(nextRun.id, nextRun);
  emitNewEvents(run, nextRun, runtimeDeps);
  saveRuntimeRun(runtimeDeps.repository, nextRun);

  if (resolved.resumeReady && resolved.approval.action.name === EXTERNAL_OSINT_FETCH_TOOL) {
    try {
      nextRun = await resumeApprovedExternalFetchRun(nextRun, resolved.approval, {
        osint: config.osint,
        osintFetchImpl: runtimeDeps.osintFetchImpl,
        osintSearchInvoker: runtimeDeps.osintSearchInvoker
      });
      state.runs.set(nextRun.id, nextRun);
      saveRuntimeRun(runtimeDeps.repository, nextRun);
      const fetchedCount = nextRun.outputs.resumeResult?.fetchedUnits.length ?? 0;
      const promotedCount = nextRun.outputs.resumeResult?.promotedBundles.length ?? 0;
      emit(
        nextRun,
        "external.fetch_succeeded",
        fetchedCount > 0
          ? `${EXTERNAL_OSINT_FETCH_TOOL} 승인 후 SourceVet 검증과 ACH 재평가를 완료했습니다.`
          : `${EXTERNAL_OSINT_FETCH_TOOL} 승인 후 외부 수집을 시도했지만 반영 가능한 자료가 없었습니다.`,
        {
          toolName: EXTERNAL_OSINT_FETCH_TOOL,
          evidenceCount: fetchedCount,
          promotedEvidenceCount: promotedCount,
          survivorDelta: nextRun.outputs.resumeResult?.survivorDelta
        },
        runtimeDeps
      );
      emit(nextRun, "run.succeeded", `런타임 실행 상태: ${formatRunStatusKo(nextRun.status)}.`, undefined, runtimeDeps);
    } catch (error) {
      nextRun = markRuntimeResumeFailed(nextRun, resolved.approval, error);
      state.runs.set(nextRun.id, nextRun);
      saveRuntimeRun(runtimeDeps.repository, nextRun);
      emit(
        nextRun,
        "run.resume_failed",
        nextRun.error ?? `${EXTERNAL_OSINT_FETCH_TOOL} 승인 후 런타임 재개에 실패했습니다.`,
        {
          approvalId: resolved.approval.id,
          toolName: resolved.approval.action.name,
          error: (error as Error).message
        },
        runtimeDeps
      );
      emit(nextRun, "run.failed", `런타임 실행 상태: ${formatRunStatusKo(nextRun.status)}.`, undefined, runtimeDeps);
    }
  }

  return nextRun;
}

export function rejectRuntimeApproval(
  state: RuntimeState,
  runId: string,
  input: RuntimeApprovalCommand,
  deps: RuntimeDependencies = {}
): RuntimeRun {
  const runtimeDeps = withStateRepository(state, deps);
  const run = requireRun(state, runId);
  const resolved = rejectPendingApproval(run, {
    approvalId: input.approvalId,
    toolName: input.toolName,
    actor: input.actor ?? "operator",
    reason: input.reason
  });
  state.runs.set(resolved.run.id, resolved.run);
  emitNewEvents(run, resolved.run, runtimeDeps);
  saveRuntimeRun(runtimeDeps.repository, resolved.run);
  emit(resolved.run, "run.failed", resolved.run.error ?? "승인 거부로 런타임 실행이 실패했습니다.", undefined, runtimeDeps);
  return resolved.run;
}

export function createRuntimeRouter(
  objective: string,
  deps: RuntimeDependencies = {},
  options: { withSourceVet?: boolean; investigationPlan?: unknown } = {}
): CapabilityRouter {
  const local = createLocalCapabilityRegistry();
  local.registerCapability(
    {
      name: "Hypothesis Analysis",
      toolName: "run_warden_team",
      server: "warden-runtime",
      risk: "WRITE",
      description: "WARDEN 전문 에이전트 팀을 런타임 MCP 스타일 capability로 실행합니다."
    },
    () =>
      runTeamWorkflow(objective, {
        withSupervisor: false,
        withSourceVet: options.withSourceVet === true,
        withBriefing: false,
        fixtureVariant: "normal",
        investigationPlan: options.investigationPlan
      })
  );

  return {
    local,
    remotes: deps.remotes ?? loadRuntimeRemotes(),
    allowlist: ["run_warden_team", "external_osint_fetch", "fixture_echo"]
  };
}

function shouldRequestModelProposal(iteration: number): boolean {
  return iteration === 1;
}

async function preflightExternalOsintApproval(
  run: RuntimeRun,
  context: {
    approvals: ReturnType<typeof createApprovalQueue>;
    deps: RuntimeDependencies;
    policy: ReturnType<typeof createPolicyEngine>;
    router: CapabilityRouter;
    trace: ReturnType<typeof createTraceRecorder>;
  }
): Promise<boolean> {
  if (!shouldPreflightExternalOsint(run)) return false;

  const plan = buildDeterministicRuntimeToolPlan(run, 2);
  emit(
    run,
    "mcp.tool_start",
    `${plan.toolName}을 정책 검토와 MCP 라우터로 전달합니다.`,
    {
      toolName: plan.toolName,
      capability: plan.capability,
      risk: plan.risk,
      plannerSource: "approval_preflight"
    },
    context.deps
  );
  const toolStartedAt = Date.now();
  const result = await routeToolCallWithPolicy(plan, context.router, {
    runId: run.id,
    role: "supervisor",
    policy: context.policy,
    approvals: context.approvals,
    trace: context.trace
  });
  const toolDurationMs = Date.now() - toolStartedAt;
  run.toolResults.push(toToolRecord(0, plan.toolName, result, toolDurationMs));
  emit(
    run,
    "mcp.tool_call",
    `${plan.toolName}: ${formatToolStatusKo(result.status)}.`,
    { decision: result.decision, error: result.error, durationMs: toolDurationMs, preflight: true },
    context.deps
  );

  if (!result.approvalRequest) return false;

  run.approvals = context.approvals.listAll();
  run.status = "waiting_approval";
  updateRuntimeAnswer(run, undefined);
  touch(run);
  emit(run, "approval.pending", `${plan.toolName} 승인 대기 중입니다.`, result.approvalRequest, context.deps);
  return true;
}

function shouldPreflightExternalOsint(run: RuntimeRun): boolean {
  if (run.maxIterations < 2) return false;
  return !run.approvals.some((approval) => approval.action.name === EXTERNAL_OSINT_FETCH_TOOL && approval.status === "pending");
}

async function requestInvestigationPlanProposal(
  run: RuntimeRun,
  model: ModelAdapter,
  deps: RuntimeDependencies
): Promise<ModelResponse<unknown> | undefined> {
  if (model.kind === "mock") return undefined;
  const modelRequest = createModelRequest({
    role: "planner",
    prompt: buildInvestigationPlanPrompt(run),
    context: summarizeRunForModel(run),
    responseFormat: "json"
  });
  emit(
    run,
    "model.requested",
    `${model.id}에 조사계획 제안을 요청합니다.`,
    { model: model.id, role: modelRequest.role, plannerKind: "investigation" },
    deps
  );
  const startedAt = Date.now();
  const response = await model.generate<unknown>(modelRequest);
  emit(
    run,
    "model.proposal",
    `${response.model}에서 조사계획 제안을 받았습니다.`,
    {
      warnings: response.warnings,
      model: response.model,
      role: modelRequest.role,
      plannerKind: "investigation",
      durationMs: Date.now() - startedAt
    },
    deps
  );
  return response;
}

function resolveDefaultAnswerMode(): RuntimeAnswerMode {
  return process.env.WARDEN_ANSWER_MODE === "assisted" ? "assisted" : "deterministic";
}

function updateRuntimeAnswer(run: RuntimeRun, latestTeamResult: TeamRunResult | undefined): void {
  refreshRuntimeDerivedOutputs(run, latestTeamResult);
}

async function finalizeRuntimeAnswer(
  run: RuntimeRun,
  latestTeamResult: TeamRunResult | undefined,
  model: ModelAdapter,
  deps: RuntimeDependencies
): Promise<void> {
  refreshRuntimeDerivedOutputs(run, latestTeamResult);
  const context = buildAnswerContext(run, latestTeamResult);
  if (run.answerMode !== "assisted") {
    const outputs = composeRuntimeAnswerOutputs(context);
    run.outputs.answer = outputs.answer;
    run.outputs.securityReport = outputs.securityReport;
    return;
  }

  const request = createAnswerDraftRequest(context);
  emit(
    run,
    "model.requested",
    `${model.id}에 답변 초안을 요청합니다.`,
    { model: model.id, role: request.role, answerMode: run.answerMode },
    deps
  );
  const modelStartedAt = Date.now();
  try {
    const response = await model.generate<unknown>(request);
    const modelDurationMs = Date.now() - modelStartedAt;
    run.modelResponses.push(response);
    emit(
      run,
      "model.proposal",
      `${response.model}에서 답변 초안을 받았습니다.`,
      { warnings: response.warnings, model: response.model, role: request.role, durationMs: modelDurationMs },
      deps
    );
    run.outputs.answer = composeModelAssistedAnswerFromResponse(buildAnswerContext(run, latestTeamResult), response);
    run.outputs.securityReport = composeSecurityReport(buildAnswerContext(run, latestTeamResult), run.outputs.answer);
  } catch (error) {
    const fallback = composeDeterministicAnswer(context);
    run.outputs.answer = {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        `모델 보조 답변 생성 실패로 deterministic answer를 사용했습니다: ${(error as Error).message}`
      ]
    };
    run.outputs.securityReport = composeSecurityReport(context, run.outputs.answer);
  }
}

function composeRuntimeAnswerOutputs(context: AnswerContext): { answer: RuntimeAnswer; securityReport: ReturnType<typeof composeSecurityReport> } {
  const answer = composeDeterministicAnswer(context);
  return {
    answer,
    securityReport: composeSecurityReport(context, answer)
  };
}

function buildAnswerContext(run: RuntimeRun, latestTeamResult: TeamRunResult | undefined): AnswerContext {
  return {
    objective: run.objective,
    runStatus: run.status,
    teamResult: latestTeamResult,
    approvals: run.approvals,
    modelResponses: run.modelResponses,
    domainGrounding: run.outputs.domainGrounding,
    domainExpansion: run.outputs.domainExpansion,
    ragContext: run.outputs.ragContext,
    claimGraph: run.outputs.claimGraph,
    evidenceLedger: run.outputs.evidenceLedger,
    forecast: run.outputs.forecast,
    investigationPlan: run.outputs.investigationPlan,
    fetchedEvidence: run.outputs.fetchedEvidence
  };
}

function attachRuntimeAnalysisProducts(
  run: RuntimeRun,
  latestTeamResult: TeamRunResult | undefined,
  deps: RuntimeDependencies
): void {
  const previousExpansion = run.outputs.domainExpansion;
  const previousRag = run.outputs.ragContext;
  refreshRuntimeAnalysisProducts(run, latestTeamResult);

  if (run.outputs.domainExpansion && run.outputs.domainExpansion !== previousExpansion) {
    emit(
      run,
      "domain.expansion",
      "도메인 온톨로지로 질문을 확장했습니다.",
      {
        scenarioCount: run.outputs.domainExpansion.scenarios.length,
        actorCount: run.outputs.domainExpansion.actors.length,
        signalCount: run.outputs.domainExpansion.signals.length,
        sourceHintCount: run.outputs.domainExpansion.sourceHints.length,
        warnings: run.outputs.domainExpansion.warnings
      },
      deps
    );
  }

  if (run.outputs.ragContext && run.outputs.ragContext !== previousRag) {
    emit(
      run,
      "rag.retrieval",
      "로컬 RAG 근거를 검색했습니다.",
      {
        unitCount: run.outputs.ragContext.units.length,
        warnings: run.outputs.ragContext.warnings
      },
      deps
    );
  }
}

function refreshRuntimeDerivedOutputs(run: RuntimeRun, latestTeamResult: TeamRunResult | undefined): void {
  refreshRuntimeAnalysisProducts(run, latestTeamResult);
  const outputs = composeRuntimeAnswerOutputs(buildAnswerContext(run, latestTeamResult));
  run.outputs.answer = outputs.answer;
  run.outputs.securityReport = outputs.securityReport;
}

function refreshRuntimeAnalysisProducts(run: RuntimeRun, latestTeamResult: TeamRunResult | undefined): void {
  const products = buildRuntimeAnalysisProducts({
    objective: run.objective,
    investigationPlan: run.outputs.investigationPlan,
    teamResult: latestTeamResult,
    fetchedEvidence: run.outputs.fetchedEvidence,
    existing: {
      domainExpansion: run.outputs.domainExpansion,
      ragContext: run.outputs.ragContext,
      claimGraph: run.outputs.claimGraph,
      evidenceLedger: run.outputs.evidenceLedger,
      forecast: run.outputs.forecast
    }
  });
  run.outputs.domainExpansion = products.domainExpansion;
  run.outputs.ragContext = products.ragContext;
  run.outputs.claimGraph = products.claimGraph;
  run.outputs.evidenceLedger = products.evidenceLedger;
  run.outputs.forecast = products.forecast;
}

function attachDomainGrounding(run: RuntimeRun, deps: RuntimeDependencies): void {
  const grounding = buildRuntimeDomainGrounding(run.objective);
  if (!grounding) return;
  run.outputs.domainGrounding = grounding;
  emit(
    run,
    "domain.grounding",
    `공급망 도메인 근거 ${grounding.evidence.length}건을 로컬 프로파일에서 검색했습니다.`,
    {
      domain: grounding.domain,
      confidence: grounding.confidence,
      evidenceCount: grounding.evidence.length,
      queryTags: grounding.queryTags
    },
    deps
  );
}

function buildRuntimeDomainGrounding(objective: string): RuntimeDomainGrounding | undefined {
  const grounding = retrieveSupplyChainGrounding(objective, { limit: 4 });
  if (!grounding.classification.isSupplyChainQuestion) return undefined;
  return {
    domain: grounding.classification.domain,
    confidence: grounding.classification.confidence,
    queryTags: grounding.classification.retrievalTags,
    evidence: grounding.retrieval.items.map((item) => item.unit),
    answerFrame: grounding.answerFrame
      ? {
          id: grounding.answerFrame.id,
          intent: grounding.answerFrame.intent,
          outline: grounding.answerFrame.outline
        }
      : undefined,
    limits: grounding.profile.scope.limits,
    warnings: grounding.retrieval.warnings
  };
}

function requireRun(state: RuntimeState, runId: string): RuntimeRun {
  const run = getRuntimeRun(state, runId);
  if (!run) {
    throw new Error(`런타임 실행을 찾을 수 없습니다: ${runId}`);
  }
  return run;
}

function markRuntimeResumeFailed(run: RuntimeRun, approval: { id: string; action: { name: string } }, error: unknown): RuntimeRun {
  const failedAt = nowIso();
  const errorMessage = `${approval.action.name} 승인 후 런타임 재개 실패: ${(error as Error).message}`;
  const answer = run.outputs.answer
    ? {
        ...run.outputs.answer,
        warnings: [...run.outputs.answer.warnings, errorMessage]
      }
    : undefined;
  return {
    ...run,
    status: "failed",
    completedAt: failedAt,
    updatedAt: failedAt,
    error: errorMessage,
    outputs: {
      ...run.outputs,
      answer
    }
  };
}

function emitNewEvents(previousRun: RuntimeRun, nextRun: RuntimeRun, deps: RuntimeDependencies): void {
  for (const event of nextRun.events.slice(previousRun.events.length)) {
    appendRuntimeEvent(deps.repository, event);
    deps.onEvent?.(event, nextRun);
  }
  saveRuntimeRun(deps.repository, nextRun);
}

function loadRuntimeRemotes(): McpClient[] {
  const configPath = process.env.WARDEN_MCP_CONFIG;
  if (!configPath) return [];
  const config = loadMcpRegistryConfig(configPath);
  return config.servers.map((server) => createStdioMcpClient(server));
}

function buildRuntimePrompt(run: RuntimeRun, iteration: number): string {
  return [
    "You are the planner inside WARDEN Agent Runtime Server.",
    "Return a concise JSON proposal for the next loop step.",
    "Do not execute tools directly. Tool execution is handled only by WARDEN policy and MCP router.",
    `Objective: ${run.objective}`,
    `Iteration: ${iteration}/${run.maxIterations}`
  ].join("\n");
}

function buildInvestigationPlanPrompt(run: RuntimeRun): string {
  return [
    "You are WARDEN's investigation planner for security, geopolitics, supply-chain, and forecast analysis.",
    "Return JSON only. Do not execute tools.",
    "Schema:",
    "{",
    '  "schemaVersion": "p19.investigation-plan.v1",',
    '  "objective": string,',
    '  "title": string,',
    '  "domain": "security" | "geopolitics" | "supply_chain" | "defense" | "economic_security" | "mixed",',
    '  "classification": { "scenario": "taiwan_invasion" | "korea_northeast_asia_supply_chain" | "sanctions_export_controls" | "us_alliance_response" | "claim_verification" | "generic_security", "domain": domain, "confidence": number, "matchedSignals": string[] },',
    '  "hypotheses": [{ "id": string, "label": string, "statement": string, "rationale": string, "priority": "high" | "medium" | "low", "domain": domain, "indicators": string[], "disconfirmingSignals": string[], "disconfirmingIndicators": string[] }],',
    '  "searchPlan": [{ "id": string, "query": string, "purpose": string, "sourceTypes": string[], "tags": string[] }],',
    '  "source": "model_proposal",',
    '  "warnings": string[]',
    "}",
    "Use at least 3 competing hypotheses and at least 3 search steps.",
    "Do not use the legacy fixed hypotheses 제재 우회 비축, 단순 수요 감소, 공급망 교란 unless the user's question specifically requires them.",
    `Objective: ${run.objective}`
  ].join("\n");
}

function summarizeRunForModel(run: RuntimeRun): unknown {
  return {
    runId: run.id,
    status: run.status,
    objective: run.objective,
    iteration: run.iteration,
    toolResults: run.toolResults,
    approvals: run.approvals.map((approval) => ({
      id: approval.id,
      status: approval.status,
      risk: approval.decision.risk,
      tool: approval.action.name
    }))
  };
}

function toToolRecord(
  iteration: number,
  toolName: string,
  result: { status: string; error?: string; output?: unknown },
  durationMs: number
): RuntimeToolRecord {
  return {
    iteration,
    toolName,
    status: result.status as RuntimeToolRecord["status"],
    error: result.error,
    durationMs,
    outputSummary: result.output ? summarizeOutput(result.output) : undefined
  };
}

function summarizeOutput(output: unknown): string {
  if (isTeamRunResult(output)) {
    return `teamRun=${output.run.id} status=${output.run.status} survivors=${output.outputs.ach?.survivors.join(", ") ?? "n/a"}`;
  }
  return JSON.stringify(output).slice(0, 300);
}

function isTeamRunResult(value: unknown): value is TeamRunResult {
  return Boolean(value && typeof value === "object" && "run" in value && "trace" in value && "outputs" in value);
}

function emit(
  run: RuntimeRun,
  type: RuntimeEvent["type"],
  message: string,
  data: unknown,
  deps: RuntimeDependencies
): void {
  const event: RuntimeEvent = {
    ts: nowIso(),
    runId: run.id,
    type,
    message,
    data
  };
  run.events.push(event);
  run.updatedAt = event.ts;
  appendRuntimeEvent(deps.repository, event);
  saveRuntimeRun(deps.repository, run);
  deps.onEvent?.(event, run);
}

function touch(run: RuntimeRun): void {
  run.updatedAt = nowIso();
}

function withStateRepository(state: RuntimeState, deps: RuntimeDependencies): RuntimeDependencies {
  if (deps.repository && !getRuntimeRepository(state)) {
    attachRuntimeRepository(state, deps.repository);
  }
  const repository = deps.repository ?? getRuntimeRepository(state);
  return repository ? { ...deps, repository } : deps;
}

function formatToolStatusKo(status: string): string {
  if (status === "succeeded") return "성공";
  if (status === "blocked") return "차단됨";
  if (status === "failed") return "실패";
  return status;
}

function formatRunStatusKo(status: RuntimeRun["status"]): string {
  if (status === "queued") return "대기 중";
  if (status === "running") return "실행 중";
  if (status === "waiting_approval") return "승인 대기";
  if (status === "succeeded") return "성공";
  if (status === "failed") return "실패";
  return status;
}
