import type {
  PolicyContext,
  PolicyDecision,
  PolicyEngine,
  PolicyReviewReport,
  Risk,
  ToolAction,
  ToolCallPlan
} from "./types.ts";

export function createPolicyEngine(): PolicyEngine {
  return {
    evaluate: evaluatePolicy,
    assertAllowed: assertPolicyAllowed
  };
}

export function classifyRisk(action: ToolAction): Risk {
  if (action.risk) return action.risk;

  const name = action.name.toLowerCase();
  if (action.server === "external" || includesAny(name, ["external", "crawl", "fetch", "http", "osint", "send"])) {
    return "EXTERNAL";
  }
  if (includesAny(name, ["delete", "remove", "wipe", "downgrade", "reset"])) {
    return "DESTRUCTIVE";
  }
  if (includesAny(name, ["policy", "scope", "mutation", "prompt_update", "loop_update"])) {
    return "POLICY_CHANGE";
  }
  if (includesAny(name, ["read", "get", "list", "render", "compute", "rank", "summarize"])) {
    return "READ";
  }
  return "WRITE";
}

export function evaluatePolicy(action: ToolAction, context: PolicyContext): PolicyDecision {
  const risk = classifyRisk(action);

  if (risk === "READ") {
    return { decision: "allow", risk, reason: `${action.name} is read-only for ${context.role}.` };
  }

  if (risk === "WRITE") {
    if (context.allowWrites === false) {
      return { decision: "deny", risk, reason: `${context.role} is not allowed to execute WRITE actions.` };
    }
    return { decision: "allow", risk, reason: `${action.name} is WRITE but allowed in P0 with audit.` };
  }

  if (risk === "EXTERNAL") {
    return { decision: "require_approval", risk, reason: "External calls are blocked until human approval." };
  }

  if (risk === "POLICY_CHANGE") {
    return { decision: "require_approval", risk, reason: "Policy or harness mutations require approval." };
  }

  return { decision: "deny", risk, reason: "Destructive actions are denied in P0." };
}

export function assertPolicyAllowed(decision: PolicyDecision): void {
  if (decision.decision !== "allow") {
    throw new Error(`Policy blocked action: ${decision.decision} (${decision.risk}) - ${decision.reason}`);
  }
}

export function formatPolicyDecision(action: ToolAction, decision: PolicyDecision): string {
  return `${decision.decision} ${decision.risk} for ${action.name}: ${decision.reason}`;
}

export function reviewPlannedToolCalls(calls: ToolCallPlan[], context: PolicyContext): PolicyReviewReport {
  const decisions = calls.map((call) => reviewPlannedToolCall(call, context));
  const blockedCallIds = calls
    .filter((call, index) => decisions[index].decision === "deny")
    .map((call) => call.id);
  const approvalCallIds = calls
    .filter((call, index) => decisions[index].decision === "require_approval")
    .map((call) => call.id);
  const status: PolicyReviewReport["status"] =
    blockedCallIds.length > 0 ? "blocked" : approvalCallIds.length > 0 ? "approval_required" : "allow";

  return {
    status,
    decisions,
    blockedCallIds,
    approvalCallIds,
    summary: renderPolicyReviewSummary(calls, decisions, status)
  };
}

export function requireApprovalIfExternal(call: ToolCallPlan): PolicyDecision {
  if (call.risk === "EXTERNAL") {
    return { decision: "require_approval", risk: "EXTERNAL", reason: `${call.toolName} requires human approval before external action.` };
  }
  return { decision: "allow", risk: call.risk, reason: `${call.toolName} is not an external action.` };
}

export function denyIfPolicyMutation(call: ToolCallPlan): PolicyDecision {
  if (call.risk === "POLICY_CHANGE") {
    return { decision: "deny", risk: "POLICY_CHANGE", reason: `${call.toolName} attempts to mutate WARDEN policy or harness scope.` };
  }
  return { decision: "allow", risk: call.risk, reason: `${call.toolName} does not mutate policy.` };
}

export function denyIfCapabilityMissing(call: ToolCallPlan, registry: { hasCapability(capability: string): boolean }): PolicyDecision {
  if (!registry.hasCapability(call.capability)) {
    return { decision: "deny", risk: call.risk, reason: `${call.toolName} requested unavailable capability: ${call.capability}.` };
  }
  return { decision: "allow", risk: call.risk, reason: `${call.capability} is available.` };
}

export function renderPolicyReview(report: PolicyReviewReport): string {
  return [
    `Policy review: ${report.status}`,
    `- blocked: ${report.blockedCallIds.join(", ") || "none"}`,
    `- approval required: ${report.approvalCallIds.join(", ") || "none"}`,
    ...report.decisions.map((decision) => `- ${decision.decision} ${decision.risk}: ${decision.reason}`)
  ].join("\n");
}

function reviewPlannedToolCall(call: ToolCallPlan, context: PolicyContext): PolicyDecision {
  if (context.availableCapabilities && !context.availableCapabilities.includes(call.capability)) {
    return denyIfCapabilityMissing(call, {
      hasCapability: (capability) => context.availableCapabilities?.includes(capability) ?? false
    });
  }

  const policyMutation = denyIfPolicyMutation(call);
  if (policyMutation.decision === "deny") return policyMutation;

  const external = requireApprovalIfExternal(call);
  if (external.decision === "require_approval") return external;

  return evaluatePolicy(
    {
      name: call.toolName,
      capability: call.capability,
      server: call.risk === "EXTERNAL" ? "external" : call.risk === "POLICY_CHANGE" ? "policy" : "warden",
      risk: call.risk,
      input: { inputSummary: call.inputSummary }
    },
    { ...context, role: call.requestedBy }
  );
}

function renderPolicyReviewSummary(
  calls: ToolCallPlan[],
  decisions: PolicyDecision[],
  status: PolicyReviewReport["status"]
): string {
  const counts = decisions.reduce<Record<string, number>>((acc, decision) => {
    const key = `${decision.decision}:${decision.risk}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return `Reviewed ${calls.length} planned tool call(s). status=${status}; decisions=${JSON.stringify(counts)}`;
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}
