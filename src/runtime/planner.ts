import { newId } from "../agent/ids.ts";
import type { ModelResponse } from "../agent/model-adapter.ts";
import type { RoutedToolCall } from "../agent/mcp/types.ts";
import type { RuntimeRun } from "./types.ts";
import {
  parseRuntimePlannerProposal,
  validateRuntimePlannerProposal,
  type RuntimePlannerProposal
} from "./tool-plan-schema.ts";

export type PlannerSelection = {
  selected: RoutedToolCall;
  source: "model_proposal" | "deterministic_fallback";
  warnings: string[];
};

export function selectRuntimeToolPlan(args: {
  run: RuntimeRun;
  iteration: number;
  proposal?: ModelResponse;
  allowlist: string[];
  allowedCapabilities: string[];
}): PlannerSelection {
  const fallback = buildDeterministicRuntimeToolPlan(args.run, args.iteration);
  const proposal = args.proposal ? parseRuntimePlannerProposal(args.proposal.output) : undefined;
  const validation = validateRuntimePlannerProposal(proposal, {
    allowlist: args.allowlist,
    allowedCapabilities: args.allowedCapabilities
  });

  if (validation.status === "pass" && proposal) {
    return {
      selected: mapProposalToRoutedToolCall(args.run, proposal),
      source: "model_proposal",
      warnings: validation.warnings
    };
  }

  return {
    selected: fallback,
    source: "deterministic_fallback",
    warnings: validation.warnings
  };
}

export function buildDeterministicRuntimeToolPlan(run: RuntimeRun, iteration: number): RoutedToolCall {
  if (iteration === 1) {
    return {
      id: newId("rt_tool"),
      toolName: "run_warden_team",
      capability: "Hypothesis Analysis",
      risk: "WRITE",
      inputSummary: "런타임 MCP 라우터를 통해 WARDEN 전문 에이전트 팀을 실행합니다.",
      requestedBy: "supervisor",
      input: { objective: run.objective }
    };
  }
  return {
    id: newId("rt_tool"),
    toolName: "external_osint_fetch",
    capability: "RFI Watch",
    risk: "EXTERNAL",
    inputSummary: "플래너가 외부 OSINT 수집을 요청했으며 승인 대기가 필요합니다.",
    requestedBy: "supervisor",
    input: { query: "defense supply chain import drop public sources", objective: run.objective }
  };
}

function mapProposalToRoutedToolCall(run: RuntimeRun, proposal: RuntimePlannerProposal): RoutedToolCall {
  return {
    id: newId("rt_tool"),
    toolName: proposal.requestedTool,
    capability: proposal.capability,
    risk: proposal.risk,
    inputSummary: proposal.inputSummary,
    requestedBy: "supervisor",
    input: proposal.input ?? { objective: run.objective }
  };
}
