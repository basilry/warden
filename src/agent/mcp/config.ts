import { readFileSync } from "node:fs";
import type { McpRegistryConfig, McpServerConfig } from "./types.ts";

export function loadMcpRegistryConfig(path: string): McpRegistryConfig {
  return validateMcpRegistryConfig(JSON.parse(readFileSync(path, "utf8")));
}

export function validateMcpRegistryConfig(value: unknown): McpRegistryConfig {
  if (!isRecord(value)) throw new Error("MCP registry config must be an object.");
  const mode = value.mode === "stdio" ? "stdio" : "local";
  const enabled = value.enabled === true;
  const allowlist = Array.isArray(value.allowlist) ? value.allowlist.map(String) : ["*"];
  const servers = Array.isArray(value.servers) ? value.servers.map(validateMcpServerConfig) : [];
  if (mode === "stdio" && enabled && servers.length === 0) {
    throw new Error("stdio MCP mode is enabled but no server config was provided.");
  }
  return { mode, enabled, allowlist, servers };
}

export function validateMcpServerConfig(value: unknown): McpServerConfig {
  if (!isRecord(value)) throw new Error("MCP server config must be an object.");
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("MCP server config requires a non-empty id.");
  }
  if (value.mode !== "stdio") {
    throw new Error(`Unsupported MCP server mode for ${value.id}: ${String(value.mode)}`);
  }
  if (value.enabled === true && (typeof value.command !== "string" || value.command.length === 0)) {
    throw new Error(`Enabled stdio MCP server ${value.id} requires a command.`);
  }
  return {
    id: value.id,
    mode: "stdio",
    enabled: value.enabled === true,
    command: typeof value.command === "string" ? value.command : undefined,
    args: Array.isArray(value.args) ? value.args.map(String) : [],
    env: isStringRecord(value.env) ? value.env : {},
    allowTools: Array.isArray(value.allowTools) ? value.allowTools.map(String) : [],
    commandAllowlist: Array.isArray(value.commandAllowlist) ? value.commandAllowlist.map(String) : [],
    timeoutMs: typeof value.timeoutMs === "number" && value.timeoutMs > 0 ? value.timeoutMs : 5000,
    risk: isRisk(value.risk) ? value.risk : "EXTERNAL"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRisk(value: unknown): value is McpServerConfig["risk"] {
  return value === "READ" || value === "WRITE" || value === "DESTRUCTIVE" || value === "EXTERNAL" || value === "POLICY_CHANGE";
}
