import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { createMcpRequest, encodeMcpMessage, extractToolResult, parseMcpResponse, type McpRequest, type McpResponse } from "./protocol.ts";
import { assertMcpCommandAllowed, type CommandAllowlist } from "./sandbox.ts";
import type { Capability, McpClient, McpServerConfig, RemoteToolDescriptor, ToolResult } from "./types.ts";

export type McpServerProcess = {
  config: McpServerConfig;
  process: ChildProcessWithoutNullStreams;
};

export function createStdioMcpClient(config: McpServerConfig, allowlist: CommandAllowlist = { commands: [] }): McpClient {
  return {
    config,
    discoverRemoteTools: () => discoverRemoteTools({ config } as McpClient, allowlist),
    invokeRemoteTool: (toolName, input) => invokeRemoteTool({ config } as McpClient, toolName, input, allowlist)
  };
}

export async function discoverRemoteTools(
  server: McpClient,
  allowlist: CommandAllowlist = { commands: [] }
): Promise<RemoteToolDescriptor[]> {
  if (!server.config.enabled) return [];
  if (!server.config.command) {
    throw new Error(`MCP server ${server.config.id} is enabled without a command.`);
  }
  assertMcpCommandAllowed(server.config, allowlist);

  return (server.config.allowTools ?? []).map((toolName) => ({
    name: toolName,
    serverId: server.config.id,
    capability: toolName,
    risk: server.config.risk ?? "EXTERNAL",
    description: `Configured remote MCP tool ${server.config.id}:${toolName}.`
  }));
}

export function mapRemoteToolToCapability(tool: RemoteToolDescriptor): Capability {
  return {
    name: tool.capability,
    toolName: tool.name,
    server: tool.serverId,
    risk: tool.risk ?? "EXTERNAL",
    description: tool.description ?? `Remote MCP tool ${tool.serverId}:${tool.name}`
  };
}

export async function invokeRemoteTool<T = unknown>(
  server: McpClient,
  toolName: string,
  input: unknown,
  allowlist: CommandAllowlist = { commands: [] }
): Promise<ToolResult<T>> {
  if (!server.config.enabled) {
    return { status: "blocked", error: `MCP server is disabled: ${server.config.id}`, observationTrusted: false };
  }
  if (!server.config.allowTools?.includes(toolName)) {
    return { status: "failed", error: `MCP tool is not allowlisted: ${server.config.id}:${toolName}`, observationTrusted: false };
  }

  try {
    assertMcpCommandAllowed(server.config, allowlist);
    const process = await startMcpServer(server.config);
    try {
      const request = createMcpRequest("tools/call", {
        name: toolName,
        arguments: input
      });
      const response = await sendMcpRequest(process, request);
      return {
        status: "succeeded",
        output: extractToolResult(response) as T,
        observationTrusted: false
      };
    } finally {
      await stopMcpServer(process);
    }
  } catch (error) {
    return {
      status: "failed",
      error: (error as Error).message,
      observationTrusted: false
    };
  }
}

export async function startMcpServer(config: McpServerConfig): Promise<McpServerProcess> {
  if (!config.command) throw new Error(`MCP server ${config.id} has no command.`);
  const child = spawn(config.command, config.args ?? [], {
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stderr.setEncoding("utf8");
  return { config, process: child };
}

export async function stopMcpServer(server: McpServerProcess): Promise<void> {
  if (server.process.exitCode === null) {
    server.process.kill("SIGTERM");
  }
}

export async function sendMcpRequest(server: McpServerProcess, request: McpRequest): Promise<McpResponse> {
  const timeoutMs = server.config.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      reject(new Error(`MCP request timed out after ${timeoutMs}ms.`));
      server.process.kill("SIGTERM");
    }, timeoutMs);
    const rl = createInterface({ input: server.process.stdout });

    server.process.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    rl.on("line", (line) => {
      clearTimeout(timer);
      rl.close();
      try {
        resolve(parseMcpResponse(line, request.id));
      } catch (error) {
        reject(error);
      }
    });
    server.process.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.process.on("close", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`MCP server exited early with code=${code} stderr=${stderr.trim()}`));
      }
    });

    server.process.stdin.write(encodeMcpMessage(request));
  });
}
