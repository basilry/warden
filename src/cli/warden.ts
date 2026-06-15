import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, stderr } from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWardenConfig, type WardenConfig } from "../agent/config.ts";
import { loadDotEnvFile } from "../agent/env.ts";
import { createRuntimeState, listRuntimeRuns, startRuntimeRun } from "../runtime/loop.ts";
import { createWardenRuntimeServer, renderServerBanner } from "../runtime/server.ts";
import type { RuntimeEvent, RuntimeRun, RuntimeState } from "../runtime/types.ts";

type CliOptions = {
  iterations: number;
  port: number;
  verbose: boolean;
};

const DOTENV_LOAD = loadDotEnvFile();

const DEFAULT_OPTIONS: CliOptions = {
  iterations: 2,
  port: Number(process.env.WARDEN_PORT ?? "8787"),
  verbose: false
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
      if (line === "/server") {
        output.write(`HTTP 런타임 서버를 시작하려면 ${color("warden server", "cyan")}를 실행하세요.\n`);
        continue;
      }
      await runObjective(line, state, config, options);
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
  printCliHeader(config, options);
  await runObjective(trimmed, state, config, options);
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
  options: CliOptions
): Promise<void> {
  output.write(`${color("목표", "bold")}: ${objective}\n`);
  const run = startRuntimeRun(
    state,
    {
      objective,
      maxIterations: options.iterations
    },
    {
      config,
      onEvent: (event) => printRuntimeEvent(event, options)
    }
  );
  await waitForRun(run);
  printRunResult(run);
}

async function waitForRun(run: RuntimeRun): Promise<void> {
  while (run.status === "queued" || run.status === "running") {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

function printRuntimeEvent(event: RuntimeEvent, options: CliOptions): void {
  if (!options.verbose && event.type === "run.created") {
    return;
  }

  if (event.type === "loop.iteration") {
    output.write(`${color("[루프]", "blue")} ${event.message}\n`);
    return;
  }
  if (event.type === "model.requested") {
    const model = readEventString(event, "model") ?? "model";
    output.write(`${color("[모델]", "cyan")} ${model}에 계획 제안을 요청하는 중...\n`);
    return;
  }
  if (event.type === "model.proposal") {
    const model = readEventString(event, "model");
    const durationMs = readEventNumber(event, "durationMs");
    const from = model ? ` (${model})` : "";
    output.write(`${color("[모델]", "cyan")} 모델 제안 수신${from}${formatDurationSuffix(durationMs)}\n`);
    return;
  }
  if (event.type === "mcp.tool_start") {
    const toolName = readEventString(event, "toolName") ?? "tool";
    const risk = readEventString(event, "risk");
    output.write(`${color("[도구]", "green")} ${toolName}${objectParticle(toolName)} 정책/MCP로 전달하는 중${risk ? ` (${risk})` : ""}...\n`);
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
  if (event.type === "run.failed") {
    output.write(`${color("[실패]", "red")} ${event.message}\n`);
    return;
  }
  if (options.verbose) {
    output.write(`${color(`[${event.type}]`, "dim")} ${event.message}\n`);
  }
}

function printRunResult(run: RuntimeRun): void {
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
    output.write(`ACH 생존 가설: ${run.outputs.survivors.join(", ")}\n`);
  }
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

function printRunList(state: RuntimeState): void {
  const runs = listRuntimeRuns(state);
  if (runs.length === 0) {
    output.write("현재 CLI 세션에 실행 내역이 없습니다.\n");
    return;
  }
  for (const run of runs) {
    const approvals = `승인 ${run.approvals.length}건`;
    output.write(`${run.id} ${formatRunStatusKo(run.status)} 반복=${run.iteration}/${run.maxIterations} ${approvals}\n`);
  }
}

function printCliHeader(config: WardenConfig, options: CliOptions): void {
  const version = readPackageVersion();
  output.write("\n");
  writeOperationsPanel(`WARDEN CLI Runtime v${version}`, buildRuntimeRail(config, options), [
    style("Objective run", "bold", "white"),
    `${color("모델", "gray")}: ${color(config.model.provider, "aqua")}  ${color("반복", "gray")}: ${color(String(options.iterations), "mint")}회  ${color("저장소", "gray")}: ${color(config.storage.kind, "amber")}`,
    "",
    `${color("정책", "amber")}: LLM 출력은 제안으로만 취급됩니다.`,
    `${color("권한", "gray")}: MCP 라우팅, ACH, SourceVet, 승인이 최종 권한을 가집니다.`,
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
    style("Agent runtime console", "bold", "white"),
    `${color("경로", "gray")}: ${color(displayDir, "gray")}`,
    `${color("명령어", "gray")}: ${color("/runs", "aqua")} 실행 목록 · ${color("/server", "aqua")} 서버 안내 · ${color("/help", "aqua")} 도움말 · ${color("/exit", "aqua")} 종료`,
    "",
    `${color("최근 활동", "amber")}: ${color(recentActivityText(state), "gray")}`,
    `${color(".env", "gray")}: ${DOTENV_LOAD.loaded ? color("사용 중", "green") : color("없음", "yellow")}`,
    `${color("권한 경계", "gray")}: ${config.model.provider === "codex" ? color("Codex OAuth", "green") : color("오프라인/로컬", "mint")}`,
    "",
    `${color("목표", "gray")}: 분석할 objective를 입력하고 Enter를 누르세요.`,
    `${color("외부 호출", "gray")}: ${color("사람 승인 전까지 차단됩니다.", "yellow")}`
  ]);
  output.write("\n");
  output.write(`${color("?", "aqua")} ${color("단축키", "gray")}  ${color("/runs", "aqua")} ${color("실행 목록", "gray")}  ${color("/exit", "aqua")} ${color("종료", "gray")}\n`);
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
    style("Session", "bold", "gray"),
    railMetric("Model", config.model.provider, "aqua"),
    railMetric("Server", "ready", "green"),
    railMetric("Policy", "guarded", "amber"),
    railMetric("Loop", `${options.iterations}x`, "mint"),
    "",
    style("Queue", "bold", "gray"),
    railMetric("Runs", String(runs.length), "white"),
    railMetric("Approval", String(pendingApprovals), pendingApprovals > 0 ? "yellow" : "green"),
    railMetric("Failures", String(failedRuns), failedRuns > 0 ? "red" : "green")
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
  output.write("명령어: /runs 실행 목록, /server 서버 안내, /help 도움말, /exit 종료\n\n");
}

function printHelp(): void {
  output.write("WARDEN 통제형 에이전트 런타임\n\n");
  output.write("사용법:\n");
  output.write("  warden                         대화형 채팅 모드 시작\n");
  output.write("  warden run \"<목표>\"            목표를 한 번 실행하고 종료\n");
  output.write("  warden \"<목표>\"                warden run과 동일\n");
  output.write("  warden server                  HTTP 런타임 서버 시작\n\n");
  output.write("옵션:\n");
  output.write("  -i, --iterations <n>           루프 반복 횟수, 기본 2\n");
  output.write("  -p, --port <n>                 서버 포트, 기본 WARDEN_PORT 또는 8787\n");
  output.write("  -v, --verbose                  모든 런타임 이벤트 표시\n");
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
  if (status === "rejected") return "거부됨";
  return status;
}

function translateReasonKo(reason: string): string {
  if (reason === "External calls are blocked until human approval.") {
    return "외부 호출은 사람의 승인이 있을 때까지 차단됩니다.";
  }
  return reason;
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
