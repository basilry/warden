import type { Risk, ToolCallPlan } from "../types.ts";
import type { ApprovalRequest } from "../approval.ts";
import type { PolicyDecision } from "../types.ts";

export type McpMode = "local" | "stdio";

export type Capability = {
  name: string;
  toolName: string;
  server: string;
  risk: Risk;
  description: string;
};

export type RemoteToolDescriptor = {
  name: string;
  serverId: string;
  capability: string;
  risk?: Risk;
  description?: string;
};

export type McpServerConfig = {
  id: string;
  mode: "stdio";
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  allowTools?: string[];
  commandAllowlist?: string[];
  timeoutMs?: number;
  risk?: Risk;
};

export type McpRegistryConfig = {
  mode: McpMode;
  enabled: boolean;
  allowlist: string[];
  servers: McpServerConfig[];
};

export type ToolResult<T = unknown> = {
  status: "succeeded" | "blocked" | "failed";
  output?: T;
  error?: string;
  decision?: PolicyDecision;
  approvalRequest?: ApprovalRequest;
  observationTrusted: false;
};

export type CapabilityRegistry = {
  registerCapability(capability: Capability, handler?: (input: unknown) => Promise<unknown> | unknown): void;
  discoverCapabilities(): Capability[];
  hasCapability(capability: string): boolean;
  invokeCapability<T = unknown>(toolName: string, input: unknown): Promise<ToolResult<T>>;
};

export type McpClient = {
  config: McpServerConfig;
  discoverRemoteTools(): Promise<RemoteToolDescriptor[]>;
  invokeRemoteTool<T = unknown>(toolName: string, input: unknown): Promise<ToolResult<T>>;
};

export type CapabilityRouter = {
  local: CapabilityRegistry;
  remotes: McpClient[];
  allowlist: string[];
};

export type RoutedToolCall = ToolCallPlan & {
  input?: unknown;
};
