import type { CapabilityRouter, RoutedToolCall, ToolResult } from "./types.ts";
import type { ApprovalQueue } from "../approval.ts";
import { formatPolicyDecision } from "../policy.ts";
import type { AgentRole, PolicyEngine, TraceRecorder } from "../types.ts";

export async function routeToolCall<T = unknown>(plan: RoutedToolCall, router: CapabilityRouter): Promise<ToolResult<T>> {
  if (!isAllowed(plan.toolName, router.allowlist)) {
    return {
      status: "failed",
      error: `Tool ${plan.toolName} is not allowed by MCP router allowlist.`,
      observationTrusted: false
    };
  }

  if (router.local.hasCapability(plan.toolName) || router.local.hasCapability(plan.capability)) {
    return router.local.invokeCapability<T>(plan.toolName, plan.input);
  }

  const remote = router.remotes.find((client) => client.config.allowTools?.includes(plan.toolName));
  if (!remote) {
    return {
      status: "failed",
      error: `No local or remote MCP capability matched ${plan.toolName}.`,
      observationTrusted: false
    };
  }

  return remote.invokeRemoteTool<T>(plan.toolName, plan.input);
}

export async function routeToolCallWithPolicy<T = unknown>(
  plan: RoutedToolCall,
  router: CapabilityRouter,
  context: {
    runId: string;
    taskId?: string;
    role: AgentRole;
    policy: PolicyEngine;
    approvals?: ApprovalQueue;
    trace?: TraceRecorder;
  }
): Promise<ToolResult<T>> {
  const action = {
    name: plan.toolName,
    capability: plan.capability,
    server: plan.risk === "EXTERNAL" ? "external" : "warden",
    risk: plan.risk,
    input: plan.input
  } as const;
  const decision = context.policy.evaluate(action, {
    runId: context.runId,
    taskId: context.taskId,
    role: context.role
  });
  context.trace?.record({
    phase: "policy_decision",
    actor: "policy",
    taskId: context.taskId,
    ref: plan.toolName,
    summary: formatPolicyDecision(action, decision),
    payload: decision
  });

  if (decision.decision === "require_approval") {
    const approvalRequest = context.approvals?.submit({
      runId: context.runId,
      action,
      decision,
      requestedBy: context.role,
      reason: decision.reason
    });
    context.trace?.record({
      phase: "policy_decision",
      actor: "policy",
      taskId: context.taskId,
      ref: plan.toolName,
      summary: `approval pending for ${plan.toolName}`,
      payload: approvalRequest
    });
    return {
      status: "blocked",
      error: `Approval required for ${plan.toolName}.`,
      decision,
      approvalRequest,
      observationTrusted: false
    };
  }

  if (decision.decision === "deny") {
    return {
      status: "failed",
      error: decision.reason,
      decision,
      observationTrusted: false
    };
  }

  const result = await routeToolCall<T>(plan, router);
  return { ...result, decision };
}

function isAllowed(toolName: string, allowlist: string[]): boolean {
  return allowlist.includes("*") || allowlist.includes(toolName);
}
