import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalCapabilityRegistry } from "./local-registry.ts";
import { routeToolCall } from "./router.ts";
import { createStdioMcpClient } from "./stdio-client.ts";
import type { McpServerConfig, RoutedToolCall, ToolResult } from "./types.ts";
import { ACH_MCP_TOOL_NAMES, getAchMcpToolRisk, type AchMcpInputByTool, type AchMcpOutputByTool, type AchMcpToolName } from "../../mcp/ach/types.ts";

const ACH_STDIO_SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../mcp/ach/stdio-server.ts");

export type AchMcpClientOptions = {
  config?: McpServerConfig;
};

export function createDefaultAchMcpServerConfig(): McpServerConfig {
  return {
    id: "ach-mcp",
    mode: "stdio",
    enabled: true,
    command: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", ACH_STDIO_SERVER_PATH],
    allowTools: [...ACH_MCP_TOOL_NAMES],
    commandAllowlist: [process.execPath, basename(process.execPath), "node"],
    timeoutMs: 5000,
    risk: "WRITE"
  };
}

export async function invokeAchMcpTool<TName extends AchMcpToolName>(
  toolName: TName,
  input: AchMcpInputByTool[TName],
  options: AchMcpClientOptions = {}
): Promise<ToolResult<AchMcpOutputByTool[TName]>> {
  const config = options.config ?? createDefaultAchMcpServerConfig();
  const client = createStdioMcpClient(config, {
    commands: [process.execPath, basename(process.execPath), "node"]
  });
  return routeToolCall<AchMcpOutputByTool[TName]>(
    buildAchMcpToolPlan(toolName, input),
    {
      local: createLocalCapabilityRegistry(),
      remotes: [client],
      allowlist: config.allowTools ?? [...ACH_MCP_TOOL_NAMES]
    }
  );
}

export function buildAchMcpToolPlan<TName extends AchMcpToolName>(
  toolName: TName,
  input: AchMcpInputByTool[TName]
): RoutedToolCall {
  return {
    id: `ach_mcp_${toolName}`,
    toolName,
    capability: "Hypothesis Analysis",
    risk: getAchMcpToolRisk(toolName),
    inputSummary: `Invoke ACH MCP tool ${toolName}.`,
    requestedBy: "ach_analyst",
    input
  };
}
