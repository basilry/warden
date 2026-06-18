import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, stderr } from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWardenConfig, type WardenConfig } from "../agent/config.ts";
import { loadDotEnvFile } from "../agent/env.ts";
import { assessRuntimeConfidence } from "../runtime/confidence-assessment.ts";
import {
  approveRuntimeApproval,
  createRuntimeState,
  listRuntimeRuns,
  rejectRuntimeApproval,
  startRuntimeRun
} from "../runtime/loop.ts";
import type { RuntimeAnswerMode } from "../runtime/answer.ts";
import {
  formatConfidenceKo,
  formatDomainKo,
  formatHypothesisKo,
  formatPlanSourceKo,
  formatRiskKo,
  formatScenarioKo,
  translateDisplayKo
} from "../runtime/korean-format.ts";
import { createWardenRuntimeServer, renderServerBanner } from "../runtime/server.ts";
import type { RuntimeEvent, RuntimeRun, RuntimeState } from "../runtime/types.ts";
import { deriveRuntimeVerdict, formatVerdictStatusKo, renderVerdictSummary } from "../runtime/verdict.ts";

type CliOptions = {
  answerMode: RuntimeAnswerMode;
  iterations: number;
  json: boolean;
  port: number;
  verbose: boolean;
  debugEvidence: boolean;
  approvalPrompt: boolean;
};

type ApprovalQuestion = (prompt: string) => Promise<string>;
type NextActionChoice = {
  label: string;
  description: string;
  command: string;
  kind: "approve" | "details" | "rerun" | "server" | "new_objective";
};

const DOTENV_LOAD = loadDotEnvFile();
const EVENT_STAGE_BY_RUN = new Map<string, string>();
const SPINNER_FRAMES = ["|", "/", "-", "\\"];
let spinnerTimer: ReturnType<typeof setInterval> | undefined;
let spinnerFrameIndex = 0;
let spinnerLabel = "";

const DEFAULT_OPTIONS: CliOptions = {
  answerMode: parseAnswerMode(process.env.WARDEN_ANSWER_MODE),
  iterations: 2,
  json: false,
  port: Number(process.env.WARDEN_PORT ?? "8787"),
  verbose: process.env.WARDEN_LOG_LEVEL === "verbose" || process.env.WARDEN_LOG_LEVEL === "debug",
  debugEvidence: process.env.WARDEN_LOG_LEVEL === "debug",
  approvalPrompt: process.env.WARDEN_APPROVAL_PROMPT !== "0"
};

const COLOR = {
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[38;5;75m",
  aqua: "\x1b[38;5;80m",
  teal: "\x1b[38;5;79m",
  mint: "\x1b[38;5;114m",
  amber: "\x1b[38;5;214m",
  orange: "\x1b[38;5;208m",
  gray: "\x1b[38;5;245m",
  white: "\x1b[38;5;252m",
  bold: "\x1b[1m",
  reset: "\x1b[0m"
} as const;

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0];
  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }
  if (command === "server") {
    await runServer(parseOptions(args.slice(1)));
    return;
  }
  if (command === "run") {
    const parsed = parseOptions(args.slice(1));
    await runOneShot(parsed.rest.join(" "), parsed.options);
    return;
  }
  if (command === "chat" || command === undefined || command.startsWith("-")) {
    const parsed = parseOptions(command === "chat" ? args.slice(1) : args);
    await runChat(parsed.options);
    return;
  }

  const parsed = parseOptions(args);
  await runOneShot(parsed.rest.join(" "), parsed.options);
}

function parseOptions(args: string[]): { options: CliOptions; rest: string[] } {
  const options = { ...DEFAULT_OPTIONS };
  const rest: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
      continue;
    }
    if (arg === "--debug-evidence") {
      options.debugEvidence = true;
      options.verbose = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--no-approval-prompt") {
      options.approvalPrompt = false;
      continue;
    }
    if (arg === "--answer-mode") {
      const value = args[index + 1];
      index += 1;
      options.answerMode = parseAnswerMode(value);
      continue;
    }
    if (arg === "--iterations" || arg === "-i") {
      const value = args[index + 1];
      index += 1;
      options.iterations = parsePositiveInteger(value, "--iterations");
      continue;
    }
    if (arg === "--port" || arg === "-p") {
      const value = args[index + 1];
      index += 1;
      options.port = parsePort(value);
      continue;
    }
    rest.push(arg);
  }

  return { options, rest };
}

async function runChat(options: CliOptions): Promise<void> {
  const config = loadWardenConfig();
  const state = createRuntimeState();
  printWelcomeScreen(config, options, state);

  const rl = createInterface({ input, output });
  let lastRun: RuntimeRun | undefined;
  try {
    while (true) {
      const line = (await rl.question(renderPrompt())).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      if (line === "/help" || line === "?") {
        printChatHelp();
        continue;
      }
      if (line === "/runs") {
        printRunList(state);
        continue;
      }
      if (line === "/details") {
        if (lastRun) printDetailedRunResult(lastRun);
        else output.write("상세히 볼 최근 실행이 없습니다.\n");
        continue;
      }
      if (line === "/rerun") {
        if (!lastRun) {
          output.write("다시 실행할 최근 목표가 없습니다.\n");
          continue;
        }
        lastRun = await runObjective(lastRun.objective, state, config, options, {
          approvalQuestion: (question) => rl.question(question)
        });
        continue;
      }
      if (line.startsWith("/next")) {
        lastRun = await handleNextCommand(line, lastRun, state, config, options, (question) => rl.question(question));
        continue;
      }
      if (line.startsWith("/approve")) {
        lastRun = await resolveApprovalCommand(line, "approve", state, config, options);
        continue;
      }
      if (line.startsWith("/reject") || line.startsWith("/deny")) {
        lastRun = await resolveApprovalCommand(line, "reject", state, config, options);
        continue;
      }
      if (line === "/server") {
        output.write(`HTTP 런타임 서버를 시작하려면 ${color("warden server", "cyan")}를 실행하세요.\n`);
        continue;
      }
      lastRun = await runObjective(line, state, config, options, {
        approvalQuestion: (question) => rl.question(question)
      });
    }
  } finally {
    rl.close();
  }
}

async function runOneShot(objective: string, options: CliOptions): Promise<void> {
  const trimmed = objective.trim();
  if (!trimmed) {
    throw new Error("목표가 비어 있습니다. `warden run \"...\"`을 쓰거나 `warden`으로 대화형 모드를 시작하세요.");
  }
  const config = loadWardenConfig();
  const state = createRuntimeState();
  if (!options.json) {
    printCliHeader(config, options);
  }
  let rl: ReturnType<typeof createInterface> | undefined;
  try {
    if (shouldPromptForApprovals(options)) {
      rl = createInterface({ input, output });
    }
    await runObjective(trimmed, state, config, options, {
      approvalQuestion: rl ? (question) => rl!.question(question) : undefined
    });
  } finally {
    rl?.close();
  }
}

async function runServer(options: CliOptions): Promise<void> {
  const config = loadWardenConfig();
  const { server } = createWardenRuntimeServer({ config });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      output.write(`${renderServerBanner(options.port, config)}\n`);
      resolvePromise();
    });
  });

  await new Promise<void>((resolvePromise) => {
    const close = () => {
      output.write("\nWARDEN 런타임 서버를 종료합니다.\n");
      server.close(() => resolvePromise());
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

async function runObjective(
  objective: string,
  state: RuntimeState,
  config: WardenConfig,
  options: CliOptions,
  promptOptions: { approvalQuestion?: ApprovalQuestion } = {}
): Promise<RuntimeRun> {
  if (!options.json) {
    printSectionDivider("요청 접수");
    output.write(`${color("목표", "bold")}: ${objective}\n`);
  }
  const run = startRuntimeRun(
    state,
    {
      objective,
      answerMode: options.answerMode,
      maxIterations: options.iterations
    },
    {
      config,
      onEvent: options.json ? undefined : (event) => printRuntimeEvent(event, options)
    }
  );
  await waitForRun(run);
  if (options.json) {
    printRunJson(run);
    return run;
  }
  stopSpinner();
  const promptedRun = await promptForPendingApprovals(run, state, config, options, promptOptions.approvalQuestion);
  stopSpinner();
  printRunResult(promptedRun, options);
  return promptedRun;
}

async function resolveApprovalCommand(
  line: string,
  action: "approve" | "reject",
  state: RuntimeState,
  config: WardenConfig,
  options: CliOptions
): Promise<RuntimeRun> {
  const token = line.split(/\s+/).filter(Boolean)[1];
  const selector = selectorFromApprovalToken(token);
  const run = findRunForApproval(state, selector);
  const nextRun =
    action === "approve"
      ? await approveRuntimeApproval(
          state,
          run.id,
          {
            ...selector,
            actor: "warden-cli",
            reason: "CLI operator approved the pending runtime action."
          },
          { config, onEvent: options.json ? undefined : (event) => printRuntimeEvent(event, options) }
        )
      : rejectRuntimeApproval(
          state,
          run.id,
          {
            ...selector,
            actor: "warden-cli",
            reason: "CLI operator rejected the pending runtime action."
          },
          { config, onEvent: options.json ? undefined : (event) => printRuntimeEvent(event, options) }
        );

  if (options.json) {
    printRunJson(nextRun);
    return nextRun;
  }
  printRunResult(nextRun, options);
  return nextRun;
}

async function handleNextCommand(
  line: string,
  lastRun: RuntimeRun | undefined,
  state: RuntimeState,
  config: WardenConfig,
  options: CliOptions,
  approvalQuestion: ApprovalQuestion
): Promise<RuntimeRun | undefined> {
  if (!lastRun) {
    output.write("선택할 최근 실행이 없습니다. 먼저 목표를 입력하세요.\n");
    return undefined;
  }
  const token = line.split(/\s+/).filter(Boolean)[1];
  const choices = buildNextActionChoices(lastRun);
  if (!token) {
    printNextActionChoices(lastRun);
    return lastRun;
  }
  const index = Number(token);
  if (!Number.isInteger(index) || index < 1 || index > choices.length) {
    output.write(`선택 번호는 1부터 ${choices.length} 사이여야 합니다.\n`);
    printNextActionChoices(lastRun);
    return lastRun;
  }
  const choice = choices[index - 1];
  if (choice.kind === "approve") {
    return resolveApprovalCommand(`/approve ${pendingApprovalToken(lastRun)}`, "approve", state, config, options);
  }
  if (choice.kind === "details") {
    printDetailedRunResult(lastRun);
    return lastRun;
  }
  if (choice.kind === "rerun") {
    return runObjective(lastRun.objective, state, config, options, { approvalQuestion });
  }
  if (choice.kind === "server") {
    output.write(`HTTP 런타임 서버를 시작하려면 ${color("warden server", "cyan")}를 실행하세요.\n`);
    return lastRun;
  }
  output.write("새 목표를 입력하면 같은 세션에서 이어서 분석합니다.\n");
  return lastRun;
}

async function promptForPendingApprovals(
  run: RuntimeRun,
  state: RuntimeState,
  config: WardenConfig,
  options: CliOptions,
  approvalQuestion: ApprovalQuestion | undefined
): Promise<RuntimeRun> {
  if (!shouldPromptForApprovals(options)) return run;
  if (!approvalQuestion) return run;

  let currentRun = run;
  while (currentRun.status === "waiting_approval") {
    const approval = currentRun.approvals.find((item) => item.status === "pending");
    if (!approval) return currentRun;
    const decision = await askApprovalDecision(approvalQuestion, approval);
    if (decision === "unavailable") {
      output.write(`${color("[승인]", "yellow")} 입력을 받을 수 없어 승인 대기 상태로 종료합니다. 대화형 모드에서는 /approve ${approval.action.name}을 사용할 수 있습니다.\n`);
      return currentRun;
    }

    currentRun =
      decision === "approve"
        ? await approveRuntimeApproval(
            state,
            currentRun.id,
            {
              approvalId: approval.id,
              actor: "warden-cli",
              reason: "CLI operator approved the pending runtime action."
            },
            { config, onEvent: (event) => printRuntimeEvent(event, options) }
          )
        : rejectRuntimeApproval(
            state,
            currentRun.id,
            {
              approvalId: approval.id,
              actor: "warden-cli",
              reason: "CLI operator rejected the pending runtime action."
            },
            { config, onEvent: (event) => printRuntimeEvent(event, options) }
          );
  }
  return currentRun;
}

async function askApprovalDecision(
  approvalQuestion: ApprovalQuestion,
  approval: RuntimeRun["approvals"][number]
): Promise<"approve" | "reject" | "unavailable"> {
  output.write(`${color("[승인 요청]", "yellow")} ${approval.action.name} (${formatRiskKo(approval.decision.risk)})\n`);
  output.write(`${translateReasonKo(approval.decision.reason)}\n`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let answer: string;
    try {
      answer = (await approvalQuestion(`${approval.action.name}${objectParticle(approval.action.name)} 승인하시겠습니까? 예(y) / 아니오(n): `)).trim();
    } catch {
      return "unavailable";
    }
    const decision = parseApprovalDecision(answer);
    if (decision) return decision;
    output.write("y 또는 n으로 입력하세요. 기본값은 아니오입니다.\n");
  }
  return "reject";
}

function parseApprovalDecision(value: string): "approve" | "reject" | undefined {
  const normalized = value.trim().toLowerCase();
  if (["y", "yes", "예", "네", "승인", "ㅇ", "ㅇㅇ"].includes(normalized)) return "approve";
  if (["", "n", "no", "아니오", "아니요", "거부", "ㄴ", "ㄴㄴ"].includes(normalized)) return "reject";
  return undefined;
}

function shouldPromptForApprovals(options: CliOptions): boolean {
  return options.approvalPrompt && !options.json;
}

async function waitForRun(run: RuntimeRun): Promise<void> {
  while (run.status === "queued" || run.status === "running") {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

function printRuntimeEvent(event: RuntimeEvent, options: CliOptions): void {
  stopSpinner();
  if (!options.verbose && event.type === "run.created") {
    return;
  }
  printEventStageHeader(event);

  if (event.type === "loop.iteration") {
    output.write(`${color("[루프]", "blue")} ${event.message}\n`);
    return;
  }
  if (event.type === "model.requested") {
    const model = readEventString(event, "model") ?? "model";
    const role = readEventString(event, "role");
    const label = role === "briefing" ? "답변 초안" : "계획 제안";
    output.write(`${color("[모델]", "cyan")} ${model}에 ${label}${objectParticle(label)} 요청하는 중...\n`);
    startSpinner(`${label} 대기 중`);
    return;
  }
  if (event.type === "model.proposal") {
    const model = readEventString(event, "model");
    const role = readEventString(event, "role");
    const durationMs = readEventNumber(event, "durationMs");
    const from = model ? ` (${model})` : "";
    const label = role === "briefing" ? "답변 초안" : "모델 제안";
    output.write(`${color("[모델]", "cyan")} ${label} 수신${from}${formatDurationSuffix(durationMs)}\n`);
    return;
  }
  if (event.type === "domain.grounding") {
    const evidenceCount = readEventNumber(event, "evidenceCount");
    output.write(`${color("[도메인]", "mint")} ${event.message}${evidenceCount === undefined ? "" : ` (${evidenceCount}건)`}\n`);
    return;
  }
  if (event.type === "domain.expansion") {
    const scenarioCount = readEventNumber(event, "scenarioCount");
    const signalCount = readEventNumber(event, "signalCount");
    const details = [
      scenarioCount === undefined ? undefined : `시나리오 ${scenarioCount}개`,
      signalCount === undefined ? undefined : `신호 ${signalCount}개`
    ].filter((value): value is string => Boolean(value));
    output.write(`${color("[온톨로지]", "mint")} ${event.message}${details.length ? ` (${details.join(", ")})` : ""}\n`);
    return;
  }
  if (event.type === "rag.retrieval") {
    const unitCount = readEventNumber(event, "unitCount");
    output.write(`${color("[RAG]", "aqua")} ${event.message}${unitCount === undefined ? "" : ` (${unitCount}건)`}\n`);
    return;
  }
  if (event.type === "investigation.plan") {
    const domain = readEventString(event, "domain");
    const source = readEventString(event, "source");
    const hypothesisCount = readEventNumber(event, "hypothesisCount");
    const details = [
      domain ? `도메인=${formatDomainKo(domain)}` : undefined,
      source ? `소스=${formatPlanSourceKo(source)}` : undefined,
      hypothesisCount === undefined ? undefined : `가설 ${hypothesisCount}개`
    ].filter((value): value is string => Boolean(value));
    output.write(`${color("[분석계획]", "mint")} ${event.message}${details.length ? ` (${details.join(", ")})` : ""}\n`);
    return;
  }
  if (event.type === "mcp.tool_start") {
    const toolName = readEventString(event, "toolName") ?? "tool";
    const risk = readEventString(event, "risk");
    output.write(`${color("[도구]", "green")} ${toolName}${objectParticle(toolName)} 정책/MCP로 전달하는 중${risk ? ` (${formatRiskKo(risk)})` : ""}...\n`);
    startSpinner(`${toolName} 처리 중`);
    return;
  }
  if (event.type === "mcp.tool_call") {
    output.write(`${color("[도구]", "green")} ${event.message}${formatDurationSuffix(readEventNumber(event, "durationMs"))}\n`);
    return;
  }
  if (event.type === "approval.pending") {
    output.write(`${color("[승인]", "yellow")} ${event.message}\n`);
    return;
  }
  if (event.type === "approval.resolved" || event.type === "run.resume_ready") {
    output.write(`${color("[승인]", "yellow")} ${event.message}\n`);
    if (event.type === "run.resume_ready") {
      startSpinner("외부 수집 및 재평가 중");
    }
    return;
  }
  if (event.type === "external.fetch_succeeded") {
    const evidenceCount = readEventNumber(event, "evidenceCount");
    const promotedEvidenceCount = readEventNumber(event, "promotedEvidenceCount");
    const details = [
      evidenceCount === undefined ? undefined : `수집 ${evidenceCount}건`,
      promotedEvidenceCount === undefined ? undefined : `ACH 승격 ${promotedEvidenceCount}건`
    ].filter((value): value is string => Boolean(value));
    output.write(`${color("[수집]", "aqua")} ${event.message}${details.length ? ` (${details.join(", ")})` : ""}\n`);
    return;
  }
  if (event.type === "run.resume_failed") {
    output.write(`${color("[재개]", "red")} ${event.message}\n`);
    return;
  }
  if (event.type === "run.failed") {
    output.write(`${color("[실패]", "red")} ${event.message}\n`);
    return;
  }
  if (options.verbose) {
    output.write(`${color(`[${event.type}]`, "dim")} ${event.message}\n`);
  }
}

function printEventStageHeader(event: RuntimeEvent): void {
  const stage = stageForEvent(event);
  if (!stage) return;
  const previous = EVENT_STAGE_BY_RUN.get(event.runId);
  if (previous === stage) return;
  EVENT_STAGE_BY_RUN.set(event.runId, stage);
  printSectionDivider(stage);
}

function stageForEvent(event: RuntimeEvent): string | undefined {
  if (event.type === "model.requested" || event.type === "model.proposal") {
    return EVENT_STAGE_BY_RUN.get(event.runId) ?? "1. 분석계획";
  }
  if (event.type === "investigation.plan") {
    return "1. 분석계획";
  }
  if (event.type === "domain.grounding") {
    return "1. 분석계획";
  }
  if (event.type === "domain.expansion" || event.type === "rag.retrieval") {
    return "2. 근거수집";
  }
  if (event.type === "loop.iteration" || event.type === "mcp.tool_start" || event.type === "mcp.tool_call") {
    return "3. 분석/검증";
  }
  if (event.type === "approval.pending" || event.type === "approval.resolved" || event.type === "run.resume_ready") {
    return "4. 승인";
  }
  if (event.type === "external.fetch_succeeded") return "5. 외부수집 재평가";
  if (event.type === "run.succeeded" || event.type === "run.failed" || event.type === "run.resume_failed") return "6. 완료";
  return undefined;
}

function printRunJson(run: RuntimeRun): void {
  output.write(
    `${JSON.stringify(
      {
        id: run.id,
        objective: run.objective,
        status: run.status,
        iteration: run.iteration,
        maxIterations: run.maxIterations,
        answerMode: run.answerMode,
        approvals: run.approvals.map((approval) => ({
          id: approval.id,
          status: approval.status,
          action: approval.action.name,
          risk: approval.decision.risk,
          reason: translateReasonKo(approval.reason)
        })),
        toolResults: run.toolResults,
        outputs: run.outputs,
        error: run.error
      },
      null,
      2
    )}\n`
  );
}

function printRunResult(run: RuntimeRun, options: CliOptions): void {
  if (options.verbose || options.debugEvidence) {
    printDetailedRunResult(run);
    return;
  }
  printCompactRunResult(run);
}

function printCompactRunResult(run: RuntimeRun): void {
  const answer = run.outputs.answer;
  const verdict = deriveRuntimeVerdict(run);
  const confidence = assessRuntimeConfidence(run);
  const statusColor = run.status === "failed" ? "red" : run.status === "waiting_approval" ? "yellow" : "green";

  printSectionDivider("결론");
  output.write(`${color("현재 판단", "bold")}: ${wrapLine(verdict.decision)}\n`);
  output.write(`${color("판정 수준", "gray")}: ${formatVerdictStatusKo(verdict.status)}\n`);
  output.write(`${color("신뢰도", "gray")}: ${formatConfidenceKo(verdict.confidence)} (${Math.round(verdict.confidenceScore * 100)}%)\n`);
  output.write(`${color("상태", "gray")}: ${color(formatRunStatusKo(run.status), statusColor)} · 소요 ${formatDuration(elapsedMs(run))}\n`);
  for (const reason of verdict.reasons.slice(0, 3)) {
    output.write(`- ${wrapLine(formatRuntimeAssessmentTextKo(reason), 2)}\n`);
  }

  printSectionDivider("분석계획");
  printPlanSummary(run);

  printSectionDivider("근거수집");
  printEvidenceSummary(run, answer?.evidenceUsed ?? []);

  printSectionDivider("분석/검증");
  printVerificationSummary(run);

  if (confidence.blockers.length > 0 || confidence.howToImprove.length > 0) {
    printSectionDivider("신뢰도 개선");
    printAnswerList("낮은 이유", confidence.blockers.slice(0, 4).map(formatRuntimeAssessmentTextKo), "yellow");
    printAnswerList("개선 방법", confidence.howToImprove.slice(0, 5).map(formatRuntimeAssessmentTextKo), "cyan");
  }

  printSectionDivider("승인/다음 단계");
  if (answer?.nextSteps.length) {
    printAnswerList("다음 단계", answer.nextSteps.slice(0, 3), "cyan");
  }
  if (run.approvals.length > 0) {
    output.write("승인 대기열:\n");
    for (const approval of run.approvals) {
      output.write(`- ${formatApprovalStatusKo(approval.status)}: ${approval.action.name} (${translateReasonKo(approval.reason)})\n`);
    }
  } else {
    output.write("- 현재 승인 대기 항목 없음\n");
  }
  if (run.error) {
    output.write(`${color("오류", "red")}: ${run.error}\n`);
  }
  printNextActionChoices(run);
  output.write("\n");
}

function printNextActionChoices(run: RuntimeRun): void {
  const choices = buildNextActionChoices(run);
  if (choices.length === 0) return;
  output.write("선택 가능한 다음 단계:\n");
  choices.forEach((choice, index) => {
    output.write(`${index + 1}. ${choice.label} - ${choice.description}\n`);
    output.write(`   ${color(choice.command, "gray")}\n`);
  });
}

function buildNextActionChoices(run: RuntimeRun): NextActionChoice[] {
  const pendingApproval = run.approvals.find((approval) => approval.status === "pending");
  if (pendingApproval) {
    return [
      {
        label: "외부수집 승인 후 재평가",
        description: "같은 실행에서 OSINT 수집, SourceVet, ACH 재평가를 이어갑니다.",
        command: `/next 1 또는 /approve ${pendingApproval.id}`,
        kind: "approve"
      },
      {
        label: "상세 로그 확인",
        description: "현재 실행의 상세 근거와 진단을 봅니다.",
        command: "/next 2 또는 /details",
        kind: "details"
      },
      {
        label: "새 질문 입력",
        description: "현재 실행은 승인 대기 상태로 두고 새 목표를 분석합니다.",
        command: "새 목표 문장 입력",
        kind: "new_objective"
      }
    ];
  }

  return [
    {
      label: "같은 질문 재수집",
      description: "확장된 검색식과 현재 설정으로 다시 실행합니다.",
      command: `/next 1 또는 /rerun 또는 warden run ${shellQuote(run.objective)}`,
      kind: "rerun"
    },
    {
      label: "상세 결과 보기",
      description: "기본 compact 출력보다 많은 내부 진단을 봅니다.",
      command: `/next 2 또는 /details 또는 warden run --verbose ${shellQuote(run.objective)}`,
      kind: "details"
    },
    {
      label: "서버 모드로 이어가기",
      description: "HTTP 런타임 API에서 실행/승인을 관리합니다.",
      command: "/next 3 또는 warden server",
      kind: "server"
    },
    {
      label: "새 질문 입력",
      description: "같은 CLI 세션에서 다음 목표를 바로 분석합니다.",
      command: "새 목표 문장 입력",
      kind: "new_objective"
    }
  ];
}

function pendingApprovalToken(run: RuntimeRun): string {
  return run.approvals.find((approval) => approval.status === "pending")?.id ?? "external_osint_fetch";
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function printDetailedRunResult(run: RuntimeRun): void {
  printRunAnswer(run);
  const statusColor = run.status === "failed" ? "red" : run.status === "waiting_approval" ? "yellow" : "green";
  output.write(`${color("상태", "bold")}: ${color(formatRunStatusKo(run.status), statusColor)}\n`);
  output.write(`소요 시간: ${formatDuration(elapsedMs(run))}\n`);
  if (run.outputs.teamRunId) {
    output.write(`팀 실행: ${run.outputs.teamRunId} (${formatRunStatusKo(run.outputs.teamStatus)})\n`);
  }
  if (run.outputs.traceEvents !== undefined) {
    output.write(`추적 이벤트: ${run.outputs.traceEvents}\n`);
  }
  if (run.outputs.survivors?.length) {
    output.write(`ACH 생존 가설: ${run.outputs.survivors.map(formatHypothesisKo).join(", ")}\n`);
  }
  printRuntimeDiagnostics(run);
  if (run.approvals.length > 0) {
    output.write("승인 대기열:\n");
    for (const approval of run.approvals) {
      output.write(`- ${formatApprovalStatusKo(approval.status)}: ${approval.action.name} (${translateReasonKo(approval.reason)})\n`);
    }
  }
  if (run.error) {
    output.write(`${color("오류", "red")}: ${run.error}\n`);
  }
  output.write("\n");
}

function printPlanSummary(run: RuntimeRun): void {
  const plan = run.outputs.investigationPlan;
  if (!plan) {
    output.write("- 분석계획 없음\n");
    return;
  }
  output.write(`- 도메인: ${formatDomainKo(plan.domain)}\n`);
  output.write(`- 시나리오: ${formatScenarioKo(plan.classification.scenario)}\n`);
  output.write(`- 소스: ${formatPlanSourceKo(plan.source)}\n`);
  output.write(`- 경쟁 가설: ${plan.hypotheses.length}개, 검색계획: ${plan.searchPlan.length}개\n`);
}

function printEvidenceSummary(run: RuntimeRun, evidenceItems: string[]): void {
  const localRag = run.outputs.ragContext?.units.length ?? 0;
  const fetched = run.outputs.resumeResult?.fetchedUnits.length ?? run.outputs.fetchedEvidence?.length ?? 0;
  const promoted = run.outputs.resumeResult?.promotedBundles.length ?? 0;
  const rejected = run.outputs.resumeResult?.rejectedUnits.length ?? 0;
  output.write(`- 로컬 RAG: ${localRag}건\n`);
  if (run.outputs.resumeResult) {
    output.write(`- 실시간 OSINT: ${fetched}건 수집, ${promoted}건 ACH 승격, ${rejected}건 보류\n`);
    const holdReason = summarizeHeldEvidenceReason(run.outputs.resumeResult.fetchWarnings ?? []);
    if (holdReason) output.write(`  · 보류 사유: ${wrapLine(holdReason, 4)}\n`);
  } else {
    output.write(`- 실시간 OSINT: ${fetched}건 반영\n`);
  }
  printAnswerList("참조한 자료", evidenceItems.slice(0, 8), "aqua");
}

function summarizeHeldEvidenceReason(warnings: string[]): string | undefined {
  const relevance = warnings.find((warning) => warning.includes("관련도") && warning.includes("ACH 판단 근거에서 제외"));
  if (relevance) return translateDisplayKo(relevance);
  const noUsable = warnings.find((warning) => warning.includes("반영 가능한 자료가 없었습니다"));
  if (noUsable) return translateDisplayKo(noUsable);
  const provider = warnings.find((warning) => warning.includes("OSINT 제공자 경고"));
  return provider ? translateDisplayKo(provider) : undefined;
}

function printVerificationSummary(run: RuntimeRun): void {
  const sourceReview = run.outputs.sourceReview ?? run.outputs.resumeResult?.sourceReview;
  const survivors = run.outputs.survivors ?? run.outputs.ach?.survivors ?? [];
  output.write(`- 팀 실행: ${run.outputs.teamRunId ?? "없음"}${run.outputs.teamStatus ? ` (${formatRunStatusKo(run.outputs.teamStatus)})` : ""}\n`);
  output.write(`- SourceVet: ${sourceReview ? `${formatSourceReviewStatusKo(sourceReview.status)}, 플래그 ${sourceReview.flags.length}건` : "미실행"}\n`);
  output.write(`- ACH: 생존 가설 ${survivors.length}개\n`);
  if (survivors[0]) {
    output.write(`  · 대표 가설: ${wrapLine(formatHypothesisKo(survivors[0]), 4)}\n`);
  }
  if (run.outputs.forecast) {
    output.write(
      `- Forecast: ${formatPercent(run.outputs.forecast.estimate.probability)} (${formatRange(run.outputs.forecast.estimate.probabilityRange)}), 신뢰도 ${formatConfidenceKo(run.outputs.forecast.estimate.confidenceBand.label)}\n`
    );
  }
  output.write(`- 판정 요약: ${renderVerdictSummary(deriveRuntimeVerdict(run))}\n`);
}

function printRuntimeDiagnostics(run: RuntimeRun): void {
  printAnalysisDiagnostics(run);
  const resume = run.outputs.resumeResult;
  if (!resume) return;

  const artifactCount = resume.osintArtifacts?.length ?? 0;
  output.write("외부 수집:\n");
  output.write(
    `- 모드: ${formatFetchModeKo(resume.fetchMode)}, 수집 ${resume.fetchedUnits.length}건, ACH 승격 ${resume.promotedBundles.length}건, 보류 ${resume.rejectedUnits.length}건, 아티팩트 ${artifactCount}건\n`
  );
  if (resume.sourceReview) {
    output.write(`- SourceVet: ${resume.sourceReview.status}, 플래그 ${resume.sourceReview.flags.length}건\n`);
  }

  const telemetry = resume.providerTelemetry ?? [];
  if (telemetry.length > 0) {
    const attempted = telemetry.filter((entry) => entry.attempted).length;
    const failed = telemetry.filter((entry) => entry.failed).length;
    const skipped = telemetry.filter((entry) => !entry.attempted).length;
    output.write(`- Provider: 시도 ${attempted}개, 실패 ${failed}개, 건너뜀 ${skipped}개\n`);
    for (const entry of telemetry.slice(0, 3)) {
      const status = entry.failed
        ? `실패/${formatProviderErrorKindKo(entry.errorKind)}`
        : entry.attempted
          ? "성공"
          : "건너뜀";
      output.write(`  · ${entry.sourceId}: ${status}, ${formatDuration(entry.latencyMs)}\n`);
    }
  }

  const warnings = uniqueNonEmpty([...(resume.fetchWarnings ?? []), ...(resume.providerWarnings ?? []).map((warning) => warning.message)]);
  if (warnings.length > 0) {
    output.write("- 주의:\n");
    for (const warning of warnings.slice(0, 3)) {
      output.write(`  · ${wrapLine(translateDisplayKo(warning), 4)}\n`);
    }
  }
}

function printAnalysisDiagnostics(run: RuntimeRun): void {
  const hasAnalysis = run.outputs.domainExpansion || run.outputs.ragContext || run.outputs.claimGraph || run.outputs.forecast;
  if (!hasAnalysis) return;

  output.write("분석 산출물:\n");
  if (run.outputs.domainExpansion) {
    output.write(
      `- 온톨로지: 시나리오 ${run.outputs.domainExpansion.scenarios.length}개, 액터 ${run.outputs.domainExpansion.actors.length}개, 신호 ${run.outputs.domainExpansion.signals.length}개\n`
    );
  }
  if (run.outputs.ragContext) {
    output.write(`- 로컬 RAG: 지식 단위 ${run.outputs.ragContext.units.length}건\n`);
  }
  if (run.outputs.claimGraph) {
    output.write(
      `- 근거 그래프: 정규화 주장 ${run.outputs.claimGraph.canonicalClaimCount}개, 반박 관계 ${run.outputs.claimGraph.contradictionCount}개\n`
    );
  }
  if (run.outputs.forecast) {
    output.write(
      `- 예측: ${formatPercent(run.outputs.forecast.estimate.probability)} (${formatRange(run.outputs.forecast.estimate.probabilityRange)}), 신뢰도 ${formatConfidenceKo(run.outputs.forecast.estimate.confidenceBand.label)}\n`
    );
  }
}

function printRunAnswer(run: RuntimeRun): void {
  const answer = run.outputs.answer;
  if (!answer) return;

  output.write("\n");
  output.write(`${style("답변", "bold", "amber")}\n`);
  output.write(`${wrapLine(answer.directAnswer)}\n\n`);
  printAnswerList("핵심 판단", answer.keyFindings, "green");
  printAnswerList("근거", answer.evidenceUsed, "aqua");
  printAnswerList("한계", answer.uncertainty, "yellow");
  printAnswerList("승인 필요", answer.blockedActions, "amber");
  printAnswerList("다음 단계", answer.nextSteps, "cyan");
  if (answer.warnings.length > 0) {
    printAnswerList("시스템 주의", answer.warnings.slice(0, 3).map(translateDisplayKo), "gray");
  }
  output.write(`${color("권위 참조", "gray")}: ${answer.authorityRefs.join(", ")}\n\n`);
  printSecurityReport(run);
}

function printSecurityReport(run: RuntimeRun): void {
  const report = run.outputs.securityReport;
  if (!report) return;
  output.write(`${style("보안분석 보고서", "bold", "amber")}\n`);
  output.write(`${color("신뢰도", "gray")}: ${formatConfidenceKo(report.confidence.level)} - ${wrapLine(report.confidence.rationale)}\n\n`);
  printAnswerList(report.analysis.title, report.analysis.items.slice(0, 4), "green");
  printAnswerList(report.forecast.title, report.forecast.items.slice(0, 4), "cyan");
  printAnswerList(report.uncertainty.title, report.uncertainty.items.slice(0, 4), "yellow");
  printAnswerList(report.collectionGaps.title, report.collectionGaps.items.slice(0, 4), "amber");
  printAnswerList(report.watchIndicators.title, report.watchIndicators.items.slice(0, 6), "aqua");
}

function printAnswerList(title: string, items: string[], titleColor: keyof typeof COLOR): void {
  if (items.length === 0) return;
  output.write(`${style(title, "bold", titleColor)}\n`);
  for (const item of items) {
    output.write(`- ${wrapLine(item, 2)}\n`);
  }
  output.write("\n");
}

function printSectionDivider(title: string): void {
  const width = terminalWidth();
  const line = "─".repeat(width);
  output.write(`\n${color(line, "dim")}\n${style(title, "bold", "amber")}\n${color(line, "dim")}\n`);
}

function printRunList(state: RuntimeState): void {
  const runs = listRuntimeRuns(state);
  if (runs.length === 0) {
    output.write("현재 CLI 세션에 실행 내역이 없습니다.\n");
    return;
  }
  for (const run of runs) {
    const approvals = `승인 ${run.approvals.length}건`;
    const fetched = run.outputs.resumeResult ? ` 수집=${run.outputs.resumeResult.fetchedUnits.length}` : "";
    output.write(`${run.id} ${formatRunStatusKo(run.status)} 반복=${run.iteration}/${run.maxIterations} ${approvals}${fetched}\n`);
  }
}

function printCliHeader(config: WardenConfig, options: CliOptions): void {
  const version = readPackageVersion();
  output.write("\n");
  writeOperationsPanel(`WARDEN CLI Runtime v${version}`, buildRuntimeRail(config, options), [
    style("목표 실행", "bold", "white"),
    `${color("모델", "gray")}: ${color(config.model.provider, "aqua")}  ${color("반복", "gray")}: ${color(String(options.iterations), "mint")}회  ${color("저장소", "gray")}: ${color(formatStorageKindKo(config.storage.kind), "amber")}`,
    "",
    `${color("정책", "amber")}: LLM 출력은 제안으로만 취급됩니다.`,
    `${color("권한", "gray")}: MCP 라우팅, ACH, 검증, 승인이 최종 권한을 가집니다.`,
    `${color("외부 호출", "gray")}: ${color("승인 전 차단", "yellow")}`
  ]);
  output.write("\n");
}

function printWelcomeScreen(config: WardenConfig, options: CliOptions, state: RuntimeState): void {
  const version = readPackageVersion();
  const currentDir = process.cwd();
  const home = process.env.HOME;
  const displayDir = home && currentDir.startsWith(home) ? `~${currentDir.slice(home.length)}` : currentDir;

  output.write("\n");
  writeOperationsPanel(`WARDEN CLI Runtime v${version}`, buildRuntimeRail(config, options, state), [
    style("에이전트 런타임 콘솔", "bold", "white"),
    `${color("경로", "gray")}: ${color(displayDir, "gray")}`,
    `${color("명령어", "gray")}: ${color("/runs", "aqua")} 실행 목록 · ${color("/next", "aqua")} 다음 단계 · ${color("/server", "aqua")} 서버 안내 · ${color("/help", "aqua")} 도움말 · ${color("/exit", "aqua")} 종료`,
    "",
    `${color("최근 활동", "amber")}: ${color(recentActivityText(state), "gray")}`,
    `${color(".env", "gray")}: ${DOTENV_LOAD.loaded ? color("사용 중", "green") : color("없음", "yellow")}`,
    `${color("권한 경계", "gray")}: ${config.model.provider === "codex" ? color("Codex OAuth", "green") : color("오프라인/로컬", "mint")}`,
    "",
    `${color("목표", "gray")}: 분석할 objective를 입력하고 Enter를 누르세요.`,
    `${color("외부 호출", "gray")}: ${color("사람 승인 전까지 차단됩니다.", "yellow")}`
  ]);
  output.write("\n");
  output.write(`${color("?", "aqua")} ${color("단축키", "gray")}  ${color("/runs", "aqua")} ${color("실행 목록", "gray")}  ${color("/next", "aqua")} ${color("다음 단계", "gray")}  ${color("/approve", "aqua")} ${color("승인", "gray")}  ${color("/exit", "aqua")} ${color("종료", "gray")}\n`);
}

function buildRuntimeRail(config: WardenConfig, options: CliOptions, state?: RuntimeState): string[] {
  const runs = state ? listRuntimeRuns(state) : [];
  const pendingApprovals = runs.reduce(
    (total, run) => total + run.approvals.filter((approval) => approval.status === "pending").length,
    0
  );
  const failedRuns = runs.filter((run) => run.status === "failed").length;

  return [
    `${style("▼", "bold", "amber")} ${style("WARDEN", "bold", "white")}`,
    "",
    style("세션", "bold", "gray"),
    railMetric("모델", config.model.provider, "aqua"),
    railMetric("서버", "준비", "green"),
    railMetric("정책", "보호", "amber"),
    railMetric("루프", `${options.iterations}회`, "mint"),
    "",
    style("대기열", "bold", "gray"),
    railMetric("실행", String(runs.length), "white"),
    railMetric("승인", String(pendingApprovals), pendingApprovals > 0 ? "yellow" : "green"),
    railMetric("실패", String(failedRuns), failedRuns > 0 ? "red" : "green")
  ];
}

function railMetric(label: string, value: string, valueColor: keyof typeof COLOR): string {
  const labelWidth = 10;
  const gap = Math.max(1, labelWidth - stringWidth(label));
  return `${color(label, "gray")}${" ".repeat(gap)}${color(value, valueColor)}`;
}

function writeOperationsPanel(title: string, railLines: string[], mainLines: string[]): void {
  const width = terminalWidth();
  const railWidth = Math.min(24, Math.max(20, Math.floor(width * 0.22)));
  const mainWidth = width - railWidth - 7;
  const rows = Math.max(railLines.length, mainLines.length);

  writePanelTop(title, width);
  for (let index = 0; index < rows; index += 1) {
    writeSplitRow(railLines[index] ?? "", mainLines[index] ?? "", railWidth, mainWidth);
  }
  writePanelBottom(width);
}

function writePanelTop(title: string, width: number): void {
  const titleText = truncateDisplay(` ${title} `, Math.max(0, width - 4));
  const filler = "─".repeat(Math.max(0, width - stringWidth(titleText) - 3));
  output.write(`${color("╭─", "blue")}${style(titleText, "bold", "white")}${color(filler, "blue")}${color("╮", "blue")}\n`);
}

function writeSplitRow(rail: string, main: string, railWidth: number, mainWidth: number): void {
  output.write(
    `${color("│", "blue")} ${padDisplay(rail, railWidth)} ${color("│", "blue")} ${padDisplay(main, mainWidth)} ${color("│", "blue")}\n`
  );
}

function writePanelBottom(width: number): void {
  output.write(`${color("╰", "blue")}${color("─".repeat(width - 2), "blue")}${color("╯", "blue")}\n`);
}

function printChatHelp(): void {
  output.write("목표를 입력하고 enter를 누르세요.\n");
  output.write("명령어: /runs 실행 목록, /next [번호] 다음 단계 선택, /rerun 재실행, /details 상세보기, /approve 승인, /reject 거부, /server 서버 안내, /exit 종료\n\n");
}

function printHelp(): void {
  output.write("WARDEN 통제형 에이전트 런타임\n\n");
  output.write("사용법:\n");
  output.write("  warden                         대화형 채팅 모드 시작\n");
  output.write("  warden run \"<목표>\"            목표를 한 번 실행하고 종료\n");
  output.write("  warden \"<목표>\"                warden run과 동일\n");
  output.write("  warden server                  HTTP 런타임 서버 시작\n\n");
  output.write("대화형 승인 명령:\n");
  output.write("  /approve [approvalId|toolName] 승인 대기 도구를 승인하고 재개\n");
  output.write("  /reject [approvalId|toolName]  승인 대기 도구를 거부하고 실행 실패 처리\n\n");
  output.write("대화형 이어가기 명령:\n");
  output.write("  /next                          최근 실행의 선택 가능한 다음 단계 표시\n");
  output.write("  /next <번호>                   표시된 다음 단계 실행\n");
  output.write("  /rerun                         최근 목표를 다시 실행\n");
  output.write("  /details                       최근 실행의 상세 결과 표시\n\n");
  output.write("옵션:\n");
  output.write("  --answer-mode <deterministic|assisted> 답변 생성 모드, 기본 WARDEN_ANSWER_MODE 또는 deterministic\n");
  output.write("  --json                         1회 실행 결과를 JSON으로 출력\n");
  output.write("  -i, --iterations <n>           루프 반복 횟수, 기본 2\n");
  output.write("  -p, --port <n>                 서버 포트, 기본 WARDEN_PORT 또는 8787\n");
  output.write("  -v, --verbose                  모든 런타임 이벤트 표시\n");
  output.write("  --debug-evidence               상세 근거 디버그 모드 활성화\n");
  output.write("  --no-approval-prompt           승인 대기 시 y/n 질문 없이 상태만 출력\n");
}

function parseAnswerMode(value: string | undefined): RuntimeAnswerMode {
  if (!value || value === "deterministic") return "deterministic";
  if (value === "assisted") return "assisted";
  throw new Error(`올바르지 않은 answer mode입니다: ${value}. deterministic 또는 assisted를 사용하세요.`);
}

function parsePositiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label}에는 양의 정수가 필요합니다. 입력값: ${value ?? "없음"}`);
  }
  return parsed;
}

function parsePort(value: string | undefined): number {
  const port = parsePositiveInteger(value, "--port");
  if (port > 65535) {
    throw new Error(`올바르지 않은 --port 값입니다: ${value}`);
  }
  return port;
}

function color(text: string, colorName: keyof typeof COLOR): string {
  if (process.env.NO_COLOR || !output.isTTY) return text;
  return `${COLOR[colorName]}${text}${COLOR.reset}`;
}

function style(text: string, ...styleNames: Array<keyof typeof COLOR>): string {
  if (process.env.NO_COLOR || !output.isTTY) return text;
  return `${styleNames.map((name) => COLOR[name]).join("")}${text}${COLOR.reset}`;
}

function renderPrompt(): string {
  const separator = "─".repeat(terminalWidth());
  return `\n${color(separator, "dim")}\n${style("▼", "bold", "amber")} ${color("❯ ", "green")}`;
}

function startSpinner(label: string): void {
  if (!shouldAnimateSpinner()) return;
  stopSpinner();
  spinnerLabel = label;
  spinnerFrameIndex = 0;
  renderSpinnerFrame();
  spinnerTimer = setInterval(renderSpinnerFrame, 120);
}

function stopSpinner(): void {
  if (!spinnerTimer) return;
  clearInterval(spinnerTimer);
  spinnerTimer = undefined;
  const width = terminalWidth();
  output.write(`\r${" ".repeat(width)}\r`);
}

function renderSpinnerFrame(): void {
  const frame = SPINNER_FRAMES[spinnerFrameIndex % SPINNER_FRAMES.length];
  spinnerFrameIndex += 1;
  output.write(`\r${color(frame, "amber")} ${color(spinnerLabel, "gray")}`);
}

function shouldAnimateSpinner(): boolean {
  return Boolean(output.isTTY && !process.env.NO_COLOR);
}

function terminalWidth(): number {
  return Math.max(72, Math.min(output.columns || 112, 128));
}

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version?: string };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function recentActivityText(state: RuntimeState): string {
  const runs = listRuntimeRuns(state);
  if (runs.length === 0) return "최근 실행 없음";
  const latest = runs[0];
  return `${latest.id} · ${formatRunStatusKo(latest.status)}`;
}

function centerText(text: string, width: number): string {
  const clipped = truncateDisplay(text, width);
  const padding = Math.max(0, width - stringWidth(clipped));
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return `${" ".repeat(left)}${clipped}${" ".repeat(right)}`;
}

function padDisplay(text: string, width: number): string {
  const clipped = truncateDisplay(text, width);
  return `${clipped}${" ".repeat(Math.max(0, width - stringWidth(clipped)))}`;
}

function wrapLine(text: string, indent = 0): string {
  const width = Math.max(48, terminalWidth() - indent);
  const prefix = " ".repeat(indent);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (stringWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.map((line, index) => (index === 0 ? line : `${prefix}${line}`)).join("\n");
}

function truncateDisplay(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  const ellipsis = "…";
  const target = Math.max(0, width - stringWidth(ellipsis));
  let result = "";
  let used = 0;
  for (const char of [...text]) {
    const charWidth = charDisplayWidth(char);
    if (used + charWidth > target) break;
    result += char;
    used += charWidth;
  }
  return `${result}${ellipsis}`;
}

function stringWidth(text: string): number {
  let width = 0;
  for (const char of [...stripAnsi(text)]) {
    width += charDisplayWidth(char);
  }
  return width;
}

function charDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0) return 0;
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6))
  ) {
    return 2;
  }
  return 1;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function readEventNumber(event: RuntimeEvent, key: string): number | undefined {
  if (!isRecord(event.data)) return undefined;
  const value = event.data[key];
  return typeof value === "number" ? value : undefined;
}

function readEventString(event: RuntimeEvent, key: string): string | undefined {
  if (!isRecord(event.data)) return undefined;
  const value = event.data[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function elapsedMs(run: RuntimeRun): number | undefined {
  const end = run.completedAt ?? run.updatedAt;
  const startMs = Date.parse(run.createdAt);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;
  return Math.max(0, endMs - startMs);
}

function formatDurationSuffix(durationMs: number | undefined): string {
  return durationMs === undefined ? "" : ` (${formatDuration(durationMs)})`;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "n/a";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10_000) / 100}%`;
}

function formatRange(range: { lower: number; upper: number }): string {
  return `${formatPercent(range.lower)}-${formatPercent(range.upper)}`;
}

function formatFetchModeKo(mode: string): string {
  if (mode === "fixture") return "로컬 고정 데이터";
  if (mode === "live-osint") return "실시간 OSINT";
  return mode;
}

function formatStorageKindKo(kind: string): string {
  if (kind === "memory") return "메모리";
  if (kind === "jsonl") return "JSONL";
  return translateDisplayKo(kind);
}

function formatProviderErrorKindKo(kind: string | undefined): string {
  if (kind === "rate_limited") return "호출 제한";
  if (kind === "timeout") return "시간 초과";
  if (kind === "http_error") return "HTTP 오류";
  if (kind === "config_invalid") return "설정 오류";
  if (kind === "malformed_response") return "응답 형식 오류";
  if (!kind) return "알 수 없음";
  return kind;
}

function formatSourceReviewStatusKo(status: string | undefined): string {
  if (status === "pass") return "통과";
  if (status === "warn") return "주의";
  if (status === "fail") return "실패";
  if (!status) return "알 수 없음";
  return translateDisplayKo(status);
}

function formatRunStatusKo(status: string | undefined): string {
  if (status === "queued") return "대기 중";
  if (status === "running") return "실행 중";
  if (status === "waiting_approval") return "승인 대기";
  if (status === "succeeded") return "성공";
  if (status === "failed") return "실패";
  if (!status) return "알 수 없음";
  return status;
}

function formatApprovalStatusKo(status: string): string {
  if (status === "pending") return "대기 중";
  if (status === "approved") return "승인됨";
  if (status === "denied" || status === "rejected") return "거부됨";
  if (status === "expired") return "만료됨";
  return status;
}

function formatRuntimeAssessmentTextKo(value: string): string {
  const text = translateDisplayKo(value);

  const achSummary = /^ACH evidence=(\d+), survivors=(\d+)\.$/.exec(text);
  if (achSummary) return `ACH 근거 ${achSummary[1]}건, 생존 가설 ${achSummary[2]}개입니다.`;

  const sourceVetSummary = /^SourceVet status=([a-z_]+), flags=(\d+)\.$/.exec(text);
  if (sourceVetSummary) {
    return `SourceVet 상태는 ${formatSourceReviewStatusKo(sourceVetSummary[1])}, 플래그 ${sourceVetSummary[2]}건입니다.`;
  }

  const forecastSummary = /^Forecast confidence=([a-z_]+)\.$/.exec(text);
  if (forecastSummary) return `예측 신뢰도는 ${formatConfidenceKo(forecastSummary[1])}입니다.`;

  const verificationSummary = /^Verification status=([a-z_]+)\.$/.exec(text);
  if (verificationSummary) return `검증 상태는 ${formatSourceReviewStatusKo(verificationSummary[1])}입니다.`;

  const pendingApprovals = /^Pending approvals: (.+)\.$/.exec(text);
  if (pendingApprovals) return `승인 대기 항목: ${pendingApprovals[1]}.`;

  const achCase = /^ACH result is present for case (.+)\.$/.exec(text);
  if (achCase) return `ACH 결과가 준비되었습니다. 사례 ID: ${achCase[1]}.`;

  const achUsesEvidence = /^ACH uses (\d+) structured evidence item\(s\)\.$/.exec(text);
  if (achUsesEvidence) return `ACH가 구조화 근거 ${achUsesEvidence[1]}건을 사용했습니다.`;

  const achSurvivors = /^ACH still has (\d+) surviving hypotheses\.$/.exec(text);
  if (achSurvivors) return `ACH 생존 가설이 ${achSurvivors[1]}개라 아직 좁혀야 합니다.`;

  const diagnosticity = /^Top ACH survivor is separated by ([\d.]+) contradiction points\.$/.exec(text);
  if (diagnosticity) return `상위 ACH 가설은 반박 점수 ${diagnosticity[1]}점 차이로 분리되어 있습니다.`;

  const sourceVetFlag = /^SourceVet ([a-z]+) flag ([^:]+): (.+)$/.exec(text);
  if (sourceVetFlag) return `SourceVet ${sourceVetFlag[1]} 플래그 ${sourceVetFlag[2]}: ${translateDisplayKo(sourceVetFlag[3])}`;

  const localRag = /^Local RAG contributed (\d+) knowledge unit\(s\)\.$/.exec(text);
  if (localRag) return `로컬 RAG가 지식 단위 ${localRag[1]}건을 제공했습니다.`;

  const domainGrounding = /^Domain grounding contributed (\d+) evidence item\(s\)\.$/.exec(text);
  if (domainGrounding) return `도메인 근거화가 근거 ${domainGrounding[1]}건을 제공했습니다.`;

  const claimGraph = /^Claim graph normalized (\d+) claim\(s\)\.$/.exec(text);
  if (claimGraph) return `근거 그래프가 주장 ${claimGraph[1]}개를 정규화했습니다.`;

  const evidenceLedger = /^Evidence ledger tracks (\d+) entry\/entries\.$/.exec(text);
  if (evidenceLedger) return `근거 원장이 항목 ${evidenceLedger[1]}건을 추적합니다.`;

  const fetchedEvidence = /^Runtime incorporated (\d+) fetched evidence unit\(s\)\.$/.exec(text);
  if (fetchedEvidence) return `런타임이 외부 수집 근거 ${fetchedEvidence[1]}건을 반영했습니다.`;

  const forecastIndicator = /^Forecast indicator confidence is only ([\d.]+)\.$/.exec(text);
  if (forecastIndicator) return `예측 지표 신뢰도가 ${forecastIndicator[1]}로 낮습니다.`;

  const sourceVetPassedFlags = /^SourceVet passed but left (\d+) flag\(s\)\.$/.exec(text);
  if (sourceVetPassedFlags) return `SourceVet은 통과했지만 플래그 ${sourceVetPassedFlags[1]}건이 남아 있습니다.`;

  const watchTrigger = /^Monitor the top watch trigger and rerun confidence when it changes: (.+)$/.exec(text);
  if (watchTrigger) return `상위 관찰 트리거를 감시하고 변화가 생기면 신뢰도를 다시 계산하세요: ${translateDisplayKo(watchTrigger[1])}`;

  const exact: Record<string, string> = {
    "Runtime completed without a pending execution gate.": "런타임이 승인 게이트에 막히지 않고 완료되었습니다.",
    "Runtime is waiting for human approval.": "런타임이 사람의 승인을 기다리고 있습니다.",
    "Pending approval prevents external evidence from being incorporated.": "승인 대기 때문에 외부 근거를 아직 반영하지 못했습니다.",
    "External or higher-risk actions remain blocked by policy approval.": "외부 호출 또는 고위험 작업이 정책 승인 전까지 차단되어 있습니다.",
    "Resolve the pending approval and resume the same run so new evidence can enter SourceVet and ACH.":
      "승인 대기를 처리하고 같은 실행을 재개하면 새 근거가 SourceVet과 ACH에 반영됩니다.",
    "Approve or deny the pending action explicitly, then rerun confidence after the runtime resumes.":
      "대기 중인 작업을 승인 또는 거부한 뒤, 런타임 재개 후 신뢰도를 다시 계산하세요.",
    "ACH result is missing.": "ACH 결과가 없습니다.",
    "No ACH matrix is available to separate competing hypotheses.": "경쟁 가설을 분리할 ACH 매트릭스가 없습니다.",
    "Run ACH with at least three competing hypotheses and structured evidence bundles.":
      "최소 3개 경쟁 가설과 구조화 근거 묶음으로 ACH를 실행하세요.",
    "ACH has no structured evidence.": "ACH에 구조화 근거가 없습니다.",
    "ACH cannot support a decision without evidence rows.": "근거 행이 없으면 ACH가 판단을 지지할 수 없습니다.",
    "Add directly relevant evidence bundles with reliability codes before rerunning ACH.":
      "ACH를 다시 실행하기 전에 직접 관련된 근거 묶음과 신뢰도 코드를 추가하세요.",
    "ACH matrix covers every evidence/hypothesis pair.": "ACH 매트릭스가 모든 근거/가설 조합을 포함합니다.",
    "ACH matrix is incomplete.": "ACH 매트릭스가 완성되지 않았습니다.",
    "Complete every ACH evidence/hypothesis cell before raising confidence.": "신뢰도를 올리기 전에 모든 ACH 근거/가설 셀을 채우세요.",
    "ACH evidence has useful diagnosticity across hypotheses.": "ACH 근거가 가설을 구분하는 데 유용합니다.",
    "Top ACH hypothesis is not clearly separated from alternatives.": "상위 ACH 가설이 대안과 충분히 분리되지 않았습니다.",
    "Collect disconfirming evidence that separates the remaining ACH survivors.":
      "남은 ACH 생존 가설을 가를 수 있는 반증 근거를 수집하세요.",
    "ACH evidence has low diagnosticity and may not distinguish hypotheses well.":
      "ACH 근거의 진단성이 낮아 가설을 잘 구분하지 못할 수 있습니다.",
    "Prefer evidence that supports one hypothesis while contradicting another.":
      "한 가설은 지지하고 다른 가설은 반박하는 근거를 우선 수집하세요.",
    "SourceVet review is missing for the evidence currently in use.": "현재 사용 중인 근거에 대한 SourceVet 검토가 없습니다.",
    "SourceVet review is missing.": "SourceVet 검토 결과가 없습니다.",
    "Run SourceVet on fetched/RAG knowledge units and feed only vetted evidence into ACH.":
      "수집/RAG 지식 단위에 SourceVet을 실행하고 검토된 근거만 ACH에 투입하세요.",
    "SourceVet passed with no source-risk flags.": "SourceVet이 출처 리스크 플래그 없이 통과했습니다.",
    "SourceVet requires review before confidence can be raised.": "신뢰도를 올리기 전에 SourceVet 검토가 필요합니다.",
    "Resolve SourceVet review-required flags with independent corroboration or source replacement.":
      "독립 교차확인 또는 출처 교체로 SourceVet 검토 필요 플래그를 해소하세요.",
    "SourceVet failed the current source set.": "현재 출처 묶음은 SourceVet을 통과하지 못했습니다.",
    "Remove or replace failed sources, then rerun SourceVet and ACH.": "실패한 출처를 제거하거나 교체한 뒤 SourceVet과 ACH를 다시 실행하세요.",
    "Independent corroboration is still required for one or more claims.":
      "하나 이상의 주장에 대해 독립 교차확인이 아직 필요합니다.",
    "Add independent sources for high-confidence claims that currently lack corroboration.":
      "교차확인이 부족한 고신뢰 주장에는 독립 출처를 추가하세요.",
    "Circular source lineage is present.": "순환 출처 계보가 존재합니다.",
    "Break circular citation chains by adding primary or independently sourced evidence.":
      "1차 출처 또는 독립 출처 근거를 추가해 순환 인용 구조를 끊으세요.",
    "Forecast products are missing, so forward-looking confidence cannot be cross-checked.":
      "예측 산출물이 없어 미래 판단 신뢰도를 교차검증할 수 없습니다.",
    "Build forecast products or watch indicators when the answer makes a forward-looking judgment.":
      "미래 판단을 포함하는 답변에는 예측 산출물 또는 관찰 지표를 구성하세요.",
    "Forecast confidence band is low.": "예측 신뢰도 구간이 낮습니다.",
    "Increase forecast confidence by confirming observed indicators and narrowing the probability range.":
      "관측 지표를 확인하고 확률 범위를 좁혀 예측 신뢰도를 높이세요.",
    "Address forecast warnings and recalculate the estimate before raising confidence.":
      "신뢰도를 올리기 전에 예측 주의사항을 해소하고 추정을 다시 계산하세요.",
    "Model responses emitted warnings.": "모델 응답에 주의사항이 있습니다.",
    "Run verifier checks against ACH, policy, SourceVet, and residual-risk constraints.":
      "ACH, 정책, SourceVet, 잔여 리스크 제약에 대해 검증자 점검을 실행하세요.",
    "Work through the answer uncertainty list and rerun the verdict after closing the highest-risk items.":
      "답변의 불확실성 항목 중 고위험 항목을 먼저 해소한 뒤 판정을 다시 실행하세요.",
    "Promote the verdict into the report and continue monitoring disconfirming indicators.":
      "판정을 보고서로 승격하되 반증 지표를 계속 감시하세요.",
    "Keep monitoring for new evidence and rerun the verdict when material facts change.":
      "새 근거를 계속 감시하고 중요한 사실이 바뀌면 판정을 다시 실행하세요."
  };
  return exact[text] ?? text;
}

function translateReasonKo(reason: string): string {
  if (reason === "External calls are blocked until human approval.") {
    return "외부 호출은 사람의 승인이 있을 때까지 차단됩니다.";
  }
  if (reason === "CLI operator approved the pending runtime action.") {
    return "CLI 운영자가 승인했습니다.";
  }
  if (reason === "CLI operator rejected the pending runtime action.") {
    return "CLI 운영자가 거부했습니다.";
  }
  return reason;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function selectorFromApprovalToken(token: string | undefined): { approvalId?: string; toolName?: string } {
  if (!token) return {};
  return token.startsWith("approval_") || token.startsWith("approval-") ? { approvalId: token } : { toolName: token };
}

function findRunForApproval(
  state: RuntimeState,
  selector: { approvalId?: string; toolName?: string }
): RuntimeRun {
  const runs = listRuntimeRuns(state);
  const matches = runs.filter((run) =>
    run.approvals.some((approval) => {
      if (approval.status !== "pending") return false;
      if (selector.approvalId) return approval.id === selector.approvalId;
      if (selector.toolName) return approval.action.name === selector.toolName;
      return true;
    })
  );
  if (matches.length === 0) {
    throw new Error("승인 대기 중인 실행을 찾을 수 없습니다.");
  }
  if (matches.length > 1 && !selector.approvalId) {
    throw new Error("승인 대기 실행이 여러 개입니다. /approve approvalId 형식으로 지정하세요.");
  }
  return matches[0];
}

function objectParticle(value: string): "을" | "를" {
  const last = [...value].at(-1);
  if (!last) return "을";
  const codePoint = last.codePointAt(0) ?? 0;
  if (codePoint < 0xac00 || codePoint > 0xd7a3) return "를";
  return (codePoint - 0xac00) % 28 === 0 ? "를" : "을";
}

const invokedAsScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url : false;
if (invokedAsScript) {
  main().catch((error) => {
    stderr.write(`WARDEN CLI 오류: ${(error as Error).message}\n`);
    process.exit(1);
  });
}
