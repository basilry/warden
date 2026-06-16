import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalCapabilityRegistry } from "./local-registry.ts";
import { routeToolCall } from "./router.ts";
import { createStdioMcpClient } from "./stdio-client.ts";
import type { McpServerConfig, RoutedToolCall, ToolResult } from "./types.ts";
import {
  getOsintMcpToolRisk,
  OSINT_MCP_TOOL_NAMES,
  type OsintMcpInputByTool,
  type OsintMcpOutputByTool,
  type OsintMcpToolName
} from "../../mcp/osint/types.ts";

const OSINT_STDIO_SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../mcp/osint/stdio-server.ts");

export type OsintMcpClientOptions = {
  config?: McpServerConfig;
};

export type OsintSearchMcpInvoker = (
  input: OsintMcpInputByTool["search_news"]
) => Promise<ToolResult<OsintMcpOutputByTool["search_news"]>>;

export function createDefaultOsintMcpServerConfig(): McpServerConfig {
  return {
    id: "osint-search-mcp",
    mode: "stdio",
    enabled: true,
    command: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", OSINT_STDIO_SERVER_PATH],
    allowTools: [...OSINT_MCP_TOOL_NAMES],
    commandAllowlist: [process.execPath, basename(process.execPath), "node"],
    timeoutMs: 15000,
    risk: "EXTERNAL"
  };
}

export async function invokeOsintMcpTool<TName extends OsintMcpToolName>(
  toolName: TName,
  input: OsintMcpInputByTool[TName],
  options: OsintMcpClientOptions = {}
): Promise<ToolResult<OsintMcpOutputByTool[TName]>> {
  const config = options.config ?? createDefaultOsintMcpServerConfig();
  const client = createStdioMcpClient(config, {
    commands: [process.execPath, basename(process.execPath), "node"]
  });
  return routeToolCall<OsintMcpOutputByTool[TName]>(
    buildOsintMcpToolPlan(toolName, input),
    {
      local: createLocalCapabilityRegistry(),
      remotes: [client],
      allowlist: config.allowTools ?? [...OSINT_MCP_TOOL_NAMES]
    }
  );
}

export function createOsintSearchMcpInvoker(options: OsintMcpClientOptions = {}): OsintSearchMcpInvoker {
  return (input) => invokeOsintMcpTool("search_news", input, options);
}

export function buildOsintMcpToolPlan<TName extends OsintMcpToolName>(
  toolName: TName,
  input: OsintMcpInputByTool[TName]
): RoutedToolCall {
  return {
    id: `osint_mcp_${toolName}`,
    toolName,
    capability: "RFI Watch",
    risk: getOsintMcpToolRisk(toolName),
    inputSummary: `Invoke OSINT MCP tool ${toolName}.`,
    requestedBy: "supervisor",
    input
  };
}
