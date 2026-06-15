import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadWardenConfig, type WardenConfig } from "../agent/config.ts";
import { redactPayload } from "../agent/security/redaction.ts";
import {
  approveRuntimeApproval,
  createRuntimeState,
  getRuntimeRun,
  listRuntimeRuns,
  rejectRuntimeApproval,
  startRuntimeRun,
  type RuntimeDependencies
} from "./loop.ts";
import type { RuntimeEvent, RuntimeRunRequest, RuntimeState } from "./types.ts";

export type RuntimeServerOptions = {
  config?: WardenConfig;
  state?: RuntimeState;
  silent?: boolean;
};

export function createWardenRuntimeServer(options: RuntimeServerOptions = {}): { server: Server; state: RuntimeState } {
  const state = options.state ?? createRuntimeState();
  const config = options.config ?? loadWardenConfig();
  const deps: RuntimeDependencies = {
    config,
    onEvent: options.silent ? undefined : logRuntimeEvent
  };

  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response, state, deps, config);
    } catch (error) {
      sendJson(response, 500, { error: (error as Error).message });
    }
  });
  return { server, state };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: RuntimeState,
  deps: RuntimeDependencies,
  config: WardenConfig
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true, service: "warden-runtime" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/") {
    sendJson(response, 200, {
      service: "WARDEN Agent Runtime Server",
      modelProvider: config.model.provider,
      endpoints: {
        createRun: "POST /runs",
        listRuns: "GET /runs",
        getRun: "GET /runs/:id",
        approve: "POST /runs/:id/approvals/:approvalId/approve",
        reject: "POST /runs/:id/approvals/:approvalId/reject",
        health: "GET /healthz"
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/runs") {
    sendJson(response, 200, { runs: listRuntimeRuns(state).map(summarizeRun) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/runs") {
    const body = await readJsonBody<RuntimeRunRequest>(request);
    const run = startRuntimeRun(state, body ?? {}, deps);
    sendJson(response, 202, {
      run: summarizeRun(run),
      links: {
        self: `/runs/${run.id}`
      }
    });
    return;
  }

  const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    const run = getRuntimeRun(state, runMatch[1]);
    if (!run) {
      sendJson(response, 404, { error: "실행을 찾을 수 없습니다." });
      return;
    }
    sendJson(response, 200, redactPayload(run));
    return;
  }

  const approvalMatch = url.pathname.match(/^\/runs\/([^/]+)\/approvals\/([^/]+)\/(approve|reject|deny)$/);
  if (request.method === "POST" && approvalMatch) {
    const body = await readJsonBody<{ actor?: string; reason?: string }>(request);
    const [, runId, approvalId, action] = approvalMatch;
    const run =
      action === "approve"
        ? await approveRuntimeApproval(
            state,
            runId,
            {
              approvalId,
              actor: body?.actor ?? "warden-server",
              reason: body?.reason ?? "HTTP operator approved the pending runtime action."
            },
            deps
          )
        : rejectRuntimeApproval(
            state,
            runId,
            {
              approvalId,
              actor: body?.actor ?? "warden-server",
              reason: body?.reason ?? "HTTP operator rejected the pending runtime action."
            },
            deps
          );
    sendJson(response, 200, redactPayload(run));
    return;
  }

  sendJson(response, 404, { error: "경로를 찾을 수 없습니다." });
}

function summarizeRun(run: ReturnType<typeof listRuntimeRuns>[number]): unknown {
  return {
    id: run.id,
    objective: run.objective,
    status: run.status,
    iteration: run.iteration,
    maxIterations: run.maxIterations,
    approvals: run.approvals.length,
    pendingApprovals: run.approvals.filter((approval) => approval.status === "pending").length,
    teamRunId: run.outputs.teamRunId,
    teamStatus: run.outputs.teamStatus,
    survivors: run.outputs.survivors,
    domainGrounding: run.outputs.domainGrounding
      ? {
          domain: run.outputs.domainGrounding.domain,
          confidence: run.outputs.domainGrounding.confidence,
          evidence: run.outputs.domainGrounding.evidence.length
        }
      : undefined,
    fetchedEvidence: run.outputs.fetchedEvidence?.length ?? 0,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T | undefined> {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
  }
  if (!text.trim()) return undefined;
  return JSON.parse(text) as T;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function logRuntimeEvent(event: RuntimeEvent): void {
  const color = event.type === "run.failed" ? "\x1b[31m" : event.type === "approval.pending" ? "\x1b[33m" : "\x1b[36m";
  const reset = "\x1b[0m";
  process.stdout.write(`${color}${formatEventTypeKo(event.type).padEnd(12)}${reset} ${event.runId} ${event.message}\n`);
}

export function renderServerBanner(port: number, config: WardenConfig): string {
  return [
    "",
    "WARDEN 에이전트 런타임 서버",
    "───────────────────────────",
    `주소      http://127.0.0.1:${port}`,
    `모델      ${config.model.provider}`,
    `저장소    ${config.storage.kind}`,
    "",
    "실행 시작:",
    `curl -sS -X POST http://127.0.0.1:${port}/runs \\`,
    "  -H 'content-type: application/json' \\",
    "  -d '{\"objective\":\"방산 공급망 리스크를 분석해줘\",\"maxIterations\":2}'",
    "",
    "실행 목록 확인:",
    `curl -sS http://127.0.0.1:${port}/runs`,
    "",
    "승인 후 재개:",
    `curl -sS -X POST http://127.0.0.1:${port}/runs/<runId>/approvals/<approvalId>/approve \\`,
    "  -H 'content-type: application/json' \\",
    "  -d '{\"actor\":\"operator\",\"reason\":\"approved\"}'",
    ""
  ].join("\n");
}

function formatEventTypeKo(type: RuntimeEvent["type"]): string {
  if (type === "run.created") return "실행생성";
  if (type === "run.started") return "실행시작";
  if (type === "loop.iteration") return "루프";
  if (type === "model.requested") return "모델요청";
  if (type === "model.proposal") return "모델응답";
  if (type === "domain.grounding") return "도메인";
  if (type === "mcp.tool_start") return "도구시작";
  if (type === "mcp.tool_call") return "도구결과";
  if (type === "approval.pending") return "승인대기";
  if (type === "approval.resolved") return "승인처리";
  if (type === "run.resume_ready") return "재개준비";
  if (type === "external.fetch_succeeded") return "외부수집";
  if (type === "run.succeeded") return "실행성공";
  if (type === "run.failed") return "실행실패";
  return type;
}
