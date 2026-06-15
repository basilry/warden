import type { PolicyContext, PolicyDecision, ToolCallPlan } from "../types.ts";

export function evaluateEgressPolicy(call: ToolCallPlan, _context: PolicyContext): PolicyDecision {
  if (call.risk === "EXTERNAL") {
    return {
      decision: "require_approval",
      risk: "EXTERNAL",
      reason: `${call.toolName} is an external egress action and requires explicit approval.`
    };
  }
  return {
    decision: "allow",
    risk: call.risk,
    reason: `${call.toolName} is not classified as external egress.`
  };
}

export function assertNoEgressWithoutApproval(call: ToolCallPlan, decision: PolicyDecision): void {
  if (call.risk === "EXTERNAL" && decision.decision !== "require_approval") {
    throw new Error(`External call ${call.toolName} did not require approval.`);
  }
}
