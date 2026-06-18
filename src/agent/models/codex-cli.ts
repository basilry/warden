import { spawn } from "node:child_process";
import type { ModelAdapter, ModelRequest, ModelResponse } from "../model-adapter.ts";
import { redactPayload, redactText } from "../security/redaction.ts";

export type CodexCliAdapterConfig = {
  command?: string;
  model?: string;
  cwd?: string;
  dryRun?: boolean;
  timeoutMs?: number;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
};

export function createCodexCliModelAdapter(config: CodexCliAdapterConfig = {}): ModelAdapter {
  const resolved = {
    command: config.command ?? "codex",
    model: config.model,
    cwd: config.cwd ?? process.cwd(),
    dryRun: config.dryRun ?? true,
    timeoutMs: config.timeoutMs ?? 120000,
    sandbox: config.sandbox ?? "read-only"
  };

  return {
    id: `codex-cli:${resolved.model ?? "default"}`,
    kind: "codex",
    async generate<T>(request: ModelRequest): Promise<ModelResponse<T>> {
      const prompt = buildCodexAdapterPrompt(request);
      const args = buildCodexExecArgs(resolved);
      const payload = {
        provider: "codex-cli",
        command: resolved.command,
        args,
        cwd: resolved.cwd,
        model: resolved.model ?? "codex-default",
        sandbox: resolved.sandbox,
        prompt: redactText(prompt),
        responseFormat: request.responseFormat,
        auth: "Codex CLI managed auth: cached codex login or credentials supported by the local Codex CLI"
      };

      if (resolved.dryRun) {
        return {
          id: request.id,
          model: payload.model,
          output: payload as T,
          warnings: [
            "dry-run 모드라 codex exec를 실행하지 않았습니다",
            "Codex OAuth/API 키 자격증명은 Codex CLI가 관리하며 WARDEN은 process.env만 전달합니다",
            "Codex 실시간 출력은 실행 권한이 아니라 제안으로만 취급됩니다"
          ]
        };
      }

      const result = await runCodexExec(resolved.command, args, prompt, resolved.cwd, resolved.timeoutMs);
      return {
        id: request.id,
        model: payload.model,
        output: parseCodexOutput<T>(result.stdout, request.responseFormat),
        warnings: [
          "Codex 실시간 출력은 실행 권한이 아니라 제안으로만 취급됩니다",
          ...(result.stderr.trim() ? [`Codex CLI 진단 로그가 기록되었습니다 (${summarizeStderr(result.stderr)}).`] : [])
        ]
      };
    }
  };
}

function buildCodexExecArgs(config: Required<Omit<CodexCliAdapterConfig, "model">> & { model?: string }): string[] {
  const args = ["exec", "--ephemeral", "--sandbox", config.sandbox, "--skip-git-repo-check"];
  if (config.model) args.push("--model", config.model);
  args.push("-");
  return args;
}

function buildCodexAdapterPrompt(request: ModelRequest): string {
  const formatInstruction =
    request.responseFormat === "json"
      ? "Return only valid JSON. Do not include markdown fences or commentary."
      : "Return concise plain text.";
  return [
    "You are running as a model adapter inside WARDEN, a controlled multi-agent harness.",
    "Do not edit files, do not run commands, and do not attempt external actions.",
    "Your response is only a proposal; WARDEN policy, approval, and verification remain authoritative.",
    formatInstruction,
    "",
    `Role: ${request.role}`,
    `Prompt: ${redactText(request.prompt)}`,
    `Context JSON: ${JSON.stringify(redactPayload(request.context))}`
  ].join("\n");
}

async function runCodexExec(
  command: string,
  args: string[],
  prompt: string,
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to launch Codex CLI (${command}): ${error.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Codex CLI timed out after ${timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Codex CLI exited with code=${code} signal=${signal ?? "none"} stderr=${stderr.trim()}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin.end(prompt);
  });
}

function summarizeStderr(stderr: string): string {
  const compact = stderr.replace(/\s+/g, " ").trim();
  const model = /model:\s*([^\s]+)/i.exec(compact)?.[1];
  const provider = /provider:\s*([^\s]+)/i.exec(compact)?.[1];
  if (model && provider) return `모델=${model}, 제공자=${provider}`;
  if (model) return `모델=${model}`;
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function parseCodexOutput<T>(stdout: string, responseFormat: ModelRequest["responseFormat"]): T {
  const trimmed = stdout.trim();
  if (responseFormat === "json") {
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return { text: trimmed, parseWarning: "Codex output was not valid JSON." } as T;
    }
  }
  return trimmed as T;
}
