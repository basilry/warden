import type { Risk } from "../agent/types.ts";

export type RuntimePlannerProposal = {
  requestedTool: string;
  capability: string;
  risk: Risk;
  inputSummary: string;
  input?: unknown;
  rationale?: string;
};

export type PlannerValidationReport = {
  status: "pass" | "fail";
  warnings: string[];
};

const VALID_RISKS = new Set<Risk>(["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL", "POLICY_CHANGE"]);

export function parseRuntimePlannerProposal(output: unknown): RuntimePlannerProposal | undefined {
  const parsed = typeof output === "string" ? parseJsonObject(output) : output;
  if (!isRecord(parsed)) return undefined;
  if (
    typeof parsed.requestedTool === "string" &&
    typeof parsed.capability === "string" &&
    typeof parsed.risk === "string" &&
    typeof parsed.inputSummary === "string" &&
    isRisk(parsed.risk)
  ) {
    return {
      requestedTool: parsed.requestedTool,
      capability: parsed.capability,
      risk: parsed.risk,
      inputSummary: parsed.inputSummary,
      input: parsed.input,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined
    };
  }
  return undefined;
}

export function validateRuntimePlannerProposal(
  proposal: RuntimePlannerProposal | undefined,
  options: { allowlist: string[]; allowedCapabilities: string[] }
): PlannerValidationReport {
  const warnings: string[] = [];
  if (!proposal) {
    return { status: "fail", warnings: ["planner proposal missing or invalid; using deterministic fallback."] };
  }
  if (!options.allowlist.includes(proposal.requestedTool)) {
    warnings.push(`planner requested unknown tool "${proposal.requestedTool}"; using deterministic fallback.`);
  }
  if (!options.allowedCapabilities.includes(proposal.capability)) {
    warnings.push(`planner requested unknown capability "${proposal.capability}"; using deterministic fallback.`);
  }
  if (proposal.risk === "DESTRUCTIVE" || proposal.risk === "POLICY_CHANGE") {
    warnings.push(`planner requested blocked risk "${proposal.risk}"; using deterministic fallback.`);
  }
  if (proposal.requestedTool.trim() === "" || proposal.capability.trim() === "" || proposal.inputSummary.trim() === "") {
    warnings.push("planner proposal contains an empty required field; using deterministic fallback.");
  }
  return { status: warnings.length > 0 ? "fail" : "pass", warnings };
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRisk(value: string): value is Risk {
  return VALID_RISKS.has(value as Risk);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
