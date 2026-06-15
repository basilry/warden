import type { ApprovalQueue, ApprovalRequest } from "./approval.ts";
import { formatPolicyDecision } from "./policy.ts";
import type { AgentRole, PolicyContext, PolicyDecision, PolicyEngine, Risk, ToolAction, TraceRecorder } from "./types.ts";

export type CapabilityName =
  | "Hypothesis Analysis"
  | "Source Reliability Review"
  | "RFI Watch"
  | "Judgment Change Alert"
  | "Audit Brief Generator";

export type ToolDescriptor = {
  name: string;
  server: string;
  capability: CapabilityName;
  risk: Risk;
  description: string;
};

export type ToolAllowlist = {
  include: string[];
  exclude: string[];
};

export type ToolInvocation = {
  id: string;
  tool: string;
  input: unknown;
};

export type ToolInvocationResult<T = unknown> = {
  status: "succeeded" | "blocked" | "failed";
  descriptor: ToolDescriptor;
  decision: PolicyDecision;
  output?: T;
  approvalRequest?: ApprovalRequest;
  observationTrusted: false;
};

export type McpClientManager = {
  registerLocalTool<TInput, TOutput>(
    descriptor: ToolDescriptor,
    handler: (input: TInput) => Promise<TOutput> | TOutput
  ): void;
  discoverTools(): ToolDescriptor[];
  getToolsByCapability(capability: CapabilityName): ToolDescriptor[];
  invokeTool<T = unknown>(
    invocation: ToolInvocation,
    context: {
      runId: string;
      taskId?: string;
      role: AgentRole;
      trace: TraceRecorder;
      policy: PolicyEngine;
      approvalQueue?: ApprovalQueue;
    }
  ): Promise<ToolInvocationResult<T>>;
};

export function createMcpClientManager(config: { allowlist?: ToolAllowlist } = {}): McpClientManager {
  const tools = new Map<string, { descriptor: ToolDescriptor; handler: (input: unknown) => Promise<unknown> | unknown }>();
  const allowlist = config.allowlist ?? { include: ["*"], exclude: [] };

  return {
    registerLocalTool(descriptor, handler) {
      tools.set(descriptor.name, { descriptor, handler: handler as (input: unknown) => Promise<unknown> | unknown });
    },
    discoverTools() {
      return [...tools.values()].map((entry) => entry.descriptor).filter((descriptor) => isToolAllowed(descriptor.name, allowlist));
    },
    getToolsByCapability(capability) {
      return this.discoverTools().filter((descriptor) => descriptor.capability === capability);
    },
    async invokeTool(invocation, context) {
      const entry = tools.get(invocation.tool);
      if (!entry) {
        throw new Error(`Tool not registered: ${invocation.tool}`);
      }
      assertToolAllowed(invocation.tool, allowlist);

      const action: ToolAction = {
        name: entry.descriptor.name,
        capability: entry.descriptor.capability,
        server: entry.descriptor.server === "external" ? "external" : "warden",
        risk: entry.descriptor.risk,
        input: invocation.input
      };
      const policyContext: PolicyContext = { runId: context.runId, taskId: context.taskId, role: context.role };
      const decision = context.policy.evaluate(action, policyContext);
      context.trace.record({
        phase: "policy_decision",
        actor: "policy",
        taskId: context.taskId,
        ref: invocation.tool,
        summary: formatPolicyDecision(action, decision),
        payload: decision
      });

      if (decision.decision === "require_approval") {
        const approvalRequest = context.approvalQueue?.submit({
          runId: context.runId,
          action,
          decision,
          requestedBy: context.role,
          reason: decision.reason
        });
        context.trace.record({
          phase: "policy_decision",
          actor: "policy",
          taskId: context.taskId,
          ref: invocation.tool,
          summary: `approval pending for ${invocation.tool}`,
          payload: approvalRequest
        });
        return {
          status: "blocked",
          descriptor: entry.descriptor,
          decision,
          approvalRequest,
          observationTrusted: false
        };
      }

      context.policy.assertAllowed(decision);
      context.trace.record({
        phase: "tool_call",
        actor: "tool",
        taskId: context.taskId,
        ref: invocation.tool,
        summary: `Invoking capability tool ${invocation.tool}.`,
        payload: invocation
      });
      const output = (await entry.handler(invocation.input)) as T;
      context.trace.record({
        phase: "tool_result",
        actor: "tool",
        taskId: context.taskId,
        ref: invocation.tool,
        summary: `Tool ${invocation.tool} returned untrusted observation.`,
        payload: output
      });
      return {
        status: "succeeded",
        descriptor: entry.descriptor,
        decision,
        output,
        observationTrusted: false
      };
    }
  };
}

export function assertToolAllowed(toolName: string, allowlist: ToolAllowlist): void {
  if (!isToolAllowed(toolName, allowlist)) {
    throw new Error(`Tool ${toolName} is not allowed by tool allowlist.`);
  }
}

export function renderToolCatalog(tools: ToolDescriptor[]): string {
  return tools.map((tool) => `- ${tool.capability}: ${tool.server}:${tool.name} (${tool.risk})`).join("\n");
}

function isToolAllowed(toolName: string, allowlist: ToolAllowlist): boolean {
  const included = allowlist.include.includes("*") || allowlist.include.includes(toolName);
  const excluded = allowlist.exclude.includes(toolName);
  return included && !excluded;
}
