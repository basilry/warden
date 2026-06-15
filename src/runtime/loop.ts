import { createApprovalQueue } from "../agent/approval.ts";
import { createTraceRecorder } from "../agent/audit.ts";
import { loadWardenConfig, type WardenConfig } from "../agent/config.ts";
import { newId, nowIso } from "../agent/ids.ts";
import { createModelRequest, type ModelAdapter } from "../agent/model-adapter.ts";
import { createModelAdapterFromConfig } from "../agent/models/provider.ts";
import { createLocalCapabilityRegistry } from "../agent/mcp/local-registry.ts";
import { routeToolCallWithPolicy } from "../agent/mcp/router.ts";
import { createStdioMcpClient } from "../agent/mcp/stdio-client.ts";
import { loadMcpRegistryConfig } from "../agent/mcp/config.ts";
import type { CapabilityRouter, McpClient } from "../agent/mcp/types.ts";
import { retrieveSupplyChainGrounding } from "../agent/knowledge/retrieval.ts";
import { createPolicyEngine } from "../agent/policy.ts";
import { runTeamWorkflow } from "../agent/team-runner.ts";
import type { KnowledgeUnit, TeamRunResult } from "../agent/types.ts";
import { approvePendingApproval, rejectPendingApproval } from "./approval-actions.ts";
import {
  composeDeterministicAnswer,
  composeModelAssistedAnswerFromResponse,
  createAnswerDraftRequest,
  type AnswerContext,
  type RuntimeAnswerMode
} from "./answer.ts";
import { EXTERNAL_OSINT_FETCH_TOOL, fetchApprovedExternalOsint } from "./external-fetch.ts";
import { selectRuntimeToolPlan } from "./planner.ts";
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
  onEvent?: (event: RuntimeEvent, run: RuntimeRun) => void;
};

export type RuntimeApprovalCommand = {
  approvalId?: string;
  toolName?: string;
  actor?: string;
  reason?: string;
};

export function createRuntimeState(): RuntimeState {
  return { runs: new Map() };
}

export function startRuntimeRun(
  state: RuntimeState,
  request: RuntimeRunRequest,
  deps: RuntimeDependencies = {}
): RuntimeRun {
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
  emit(run, "run.created", "런타임 실행이 대기열에 등록되었습니다.", { objective: run.objective }, deps);
  void executeRuntimeRun(run, deps);
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
  const router = createRuntimeRouter(run.objective, deps, { withSourceVet: run.withSourceVet });
  let latestTeamResult: TeamRunResult | undefined;
  let latestPlannerProposal = undefined as Awaited<ReturnType<ModelAdapter["generate"]>> | undefined;

  run.status = "running";
  touch(run);
  emit(run, "run.started", `모델 ${model.id}로 런타임 루프를 시작했습니다.`, { model: model.id }, deps);

  try {
    attachDomainGrounding(run, deps);

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
      }

      if (result.output && isTeamRunResult(result.output)) {
        latestTeamResult = result.output;
        run.outputs = {
          teamRunId: result.output.run.id,
          teamStatus: result.output.run.status,
          survivors: result.output.outputs.ach?.survivors,
          traceEvents: result.output.trace.length,
          domainGrounding: run.outputs.domainGrounding,
          fetchedEvidence: run.outputs.fetchedEvidence,
          answer: composeDeterministicAnswer({
            objective: run.objective,
            runStatus: run.status,
            teamResult: result.output,
            approvals: run.approvals,
            modelResponses: run.modelResponses,
            domainGrounding: run.outputs.domainGrounding,
            fetchedEvidence: run.outputs.fetchedEvidence
          })
        };
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
  const run = requireRun(state, runId);
  const resolved = approvePendingApproval(run, {
    approvalId: input.approvalId,
    toolName: input.toolName,
    actor: input.actor ?? "operator",
    reason: input.reason
  });
  let nextRun = resolved.run;
  state.runs.set(nextRun.id, nextRun);
  emitNewEvents(run, nextRun, deps);

  if (resolved.resumeReady && resolved.approval.action.name === EXTERNAL_OSINT_FETCH_TOOL) {
    const fetched = fetchApprovedExternalOsint({
      query: run.objective,
      approval: resolved.approval,
      runId: nextRun.id,
      extraTags: ["runtime-resume"]
    });
    nextRun = completeApprovedExternalFetch(nextRun, fetched);
    state.runs.set(nextRun.id, nextRun);
    emit(
      nextRun,
      "external.fetch_succeeded",
      `${EXTERNAL_OSINT_FETCH_TOOL} 승인 후 로컬 fetch 근거 ${fetched.length}건을 반영했습니다.`,
      { toolName: EXTERNAL_OSINT_FETCH_TOOL, evidenceCount: fetched.length },
      deps
    );
    emit(nextRun, "run.succeeded", `런타임 실행 상태: ${formatRunStatusKo(nextRun.status)}.`, undefined, deps);
  }

  return nextRun;
}

export function rejectRuntimeApproval(
  state: RuntimeState,
  runId: string,
  input: RuntimeApprovalCommand,
  deps: RuntimeDependencies = {}
): RuntimeRun {
  const run = requireRun(state, runId);
  const resolved = rejectPendingApproval(run, {
    approvalId: input.approvalId,
    toolName: input.toolName,
    actor: input.actor ?? "operator",
    reason: input.reason
  });
  state.runs.set(resolved.run.id, resolved.run);
  emitNewEvents(run, resolved.run, deps);
  emit(resolved.run, "run.failed", resolved.run.error ?? "승인 거부로 런타임 실행이 실패했습니다.", undefined, deps);
  return resolved.run;
}

export function createRuntimeRouter(
  objective: string,
  deps: RuntimeDependencies = {},
  options: { withSourceVet?: boolean } = {}
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
        fixtureVariant: "normal"
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

function resolveDefaultAnswerMode(): RuntimeAnswerMode {
  return process.env.WARDEN_ANSWER_MODE === "assisted" ? "assisted" : "deterministic";
}

function updateRuntimeAnswer(run: RuntimeRun, latestTeamResult: TeamRunResult | undefined): void {
  run.outputs.answer = composeDeterministicAnswer({
    objective: run.objective,
    runStatus: run.status,
    teamResult: latestTeamResult,
    approvals: run.approvals,
    modelResponses: run.modelResponses,
    domainGrounding: run.outputs.domainGrounding,
    fetchedEvidence: run.outputs.fetchedEvidence
  });
}

async function finalizeRuntimeAnswer(
  run: RuntimeRun,
  latestTeamResult: TeamRunResult | undefined,
  model: ModelAdapter,
  deps: RuntimeDependencies
): Promise<void> {
  const context = buildAnswerContext(run, latestTeamResult);
  if (run.answerMode !== "assisted") {
    run.outputs.answer = composeDeterministicAnswer(context);
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
  } catch (error) {
    const fallback = composeDeterministicAnswer(context);
    run.outputs.answer = {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        `모델 보조 답변 생성 실패로 deterministic answer를 사용했습니다: ${(error as Error).message}`
      ]
    };
  }
}

function buildAnswerContext(run: RuntimeRun, latestTeamResult: TeamRunResult | undefined): AnswerContext {
  return {
    objective: run.objective,
    runStatus: run.status,
    teamResult: latestTeamResult,
    approvals: run.approvals,
    modelResponses: run.modelResponses,
    domainGrounding: run.outputs.domainGrounding,
    fetchedEvidence: run.outputs.fetchedEvidence
  };
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

function completeApprovedExternalFetch(run: RuntimeRun, fetched: KnowledgeUnit[]): RuntimeRun {
  const completedAt = nowIso();
  const fetchedEvidence = [...(run.outputs.fetchedEvidence ?? []), ...fetched];
  const previousAnswer = run.outputs.answer;
  const nextRun: RuntimeRun = {
    ...run,
    status: "succeeded",
    completedAt,
    updatedAt: completedAt,
    outputs: {
      ...run.outputs,
      fetchedEvidence
    },
    error: undefined
  };
  nextRun.outputs.answer = previousAnswer
    ? {
        ...previousAnswer,
        evidenceUsed: uniqueNonEmpty([
          ...previousAnswer.evidenceUsed,
          ...fetched.flatMap((unit) =>
            unit.claims
              .slice(0, 1)
              .map((claim) => `${claim.text} (${unit.sourceUri}, reliability=${unit.reliability ?? "unknown"})`)
          )
        ]),
        uncertainty: uniqueNonEmpty([
          ...previousAnswer.uncertainty.filter((item) => !item.includes("외부 OSINT 수집은 승인 전")),
          "승인 후 외부 fetch 근거는 현재 deterministic local fixture입니다. 실제 웹 OSINT connector로 교체해야 합니다."
        ]),
        blockedActions: previousAnswer.blockedActions.filter((item) => !item.includes(EXTERNAL_OSINT_FETCH_TOOL)),
        nextSteps: uniqueNonEmpty([
          ...previousAnswer.nextSteps.filter((item) => !item.includes(`${EXTERNAL_OSINT_FETCH_TOOL} 승인`)),
          "승인 후 추가 근거를 SourceVet과 ACH 재평가 입력으로 다시 투입해야 합니다."
        ]),
        authorityRefs: uniqueNonEmpty([
          ...previousAnswer.authorityRefs,
          `approvedExternalEvidence=${fetchedEvidence.length}`
        ])
      }
    : composeDeterministicAnswer({
        objective: nextRun.objective,
        runStatus: nextRun.status,
        approvals: nextRun.approvals,
        modelResponses: nextRun.modelResponses,
        domainGrounding: nextRun.outputs.domainGrounding,
        fetchedEvidence
      });
  return nextRun;
}

function emitNewEvents(previousRun: RuntimeRun, nextRun: RuntimeRun, deps: RuntimeDependencies): void {
  for (const event of nextRun.events.slice(previousRun.events.length)) {
    deps.onEvent?.(event, nextRun);
  }
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
  deps.onEvent?.(event, run);
}

function touch(run: RuntimeRun): void {
  run.updatedAt = nowIso();
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
