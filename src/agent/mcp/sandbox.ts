import { basename } from "node:path";
import type { McpServerConfig } from "./types.ts";

export type CommandAllowlist = {
  commands: string[];
};

export function assertMcpCommandAllowed(config: McpServerConfig, allowlist: CommandAllowlist = { commands: [] }): void {
  if (!config.command) {
    throw new Error(`MCP server ${config.id} has no command.`);
  }
  const commands = [...(config.commandAllowlist ?? []), ...allowlist.commands];
  if (commands.length === 0) {
    throw new Error(`MCP server ${config.id} has no command allowlist.`);
  }
  const command = basename(config.command);
  if (!commands.includes(config.command) && !commands.includes(command)) {
    throw new Error(`MCP command is not allowlisted for ${config.id}: ${config.command}`);
  }
}
