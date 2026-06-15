import {
  addEvidenceFromBundles,
  assessFromBundles,
  buildAchAnalysisResult,
  openCaseFromFrame
} from "../../agent/tools/ach-local.ts";
import type { AchCaseRecord, CaseFrame, EvidenceBundle } from "../../agent/types.ts";
import {
  isAchMcpToolName,
  type AchMcpInputByTool,
  type AchMcpOutputByTool,
  type AchMcpToolName
} from "./types.ts";

export function dispatchAchToolCall<TName extends AchMcpToolName>(
  name: TName,
  input: AchMcpInputByTool[TName]
): AchMcpOutputByTool[TName] {
  if (name === "open_case") {
    const parsed = parseOpenCaseInput(input);
    return { caseRecord: openCaseFromFrame(parsed.frame) } as AchMcpOutputByTool[TName];
  }
  if (name === "add_evidence") {
    const parsed = parseEvidenceMutationInput(input);
    return { caseRecord: addEvidenceFromBundles(parsed.caseRecord, parsed.bundles) } as AchMcpOutputByTool[TName];
  }
  if (name === "assess") {
    const parsed = parseEvidenceMutationInput(input);
    return { caseRecord: assessFromBundles(parsed.caseRecord, parsed.bundles) } as AchMcpOutputByTool[TName];
  }
  const parsed = parseRankInput(input);
  return {
    result: buildAchAnalysisResult(parsed.caseRecord, parsed.evidenceBundleIds)
  } as AchMcpOutputByTool[TName];
}

export function dispatchUnknownAchToolCall(name: string, input: unknown): unknown {
  if (!isAchMcpToolName(name)) {
    throw new Error(`Unknown ACH MCP tool: ${name}`);
  }
  return dispatchAchToolCall(name, input as never);
}

function parseOpenCaseInput(input: unknown): { frame: CaseFrame } {
  if (!isRecord(input) || !isCaseFrame(input.frame)) {
    throw new Error("open_case requires { frame: CaseFrame }.");
  }
  return { frame: input.frame };
}

function parseEvidenceMutationInput(input: unknown): { caseRecord: AchCaseRecord; bundles: EvidenceBundle[] } {
  if (!isRecord(input) || !isAchCaseRecord(input.caseRecord) || !isEvidenceBundleArray(input.bundles)) {
    throw new Error("ACH evidence mutation requires { caseRecord: AchCaseRecord, bundles: EvidenceBundle[] }.");
  }
  return { caseRecord: input.caseRecord, bundles: input.bundles };
}

function parseRankInput(input: unknown): { caseRecord: AchCaseRecord; evidenceBundleIds: string[] } {
  if (!isRecord(input) || !isAchCaseRecord(input.caseRecord) || !isStringArray(input.evidenceBundleIds)) {
    throw new Error("rank_hypotheses requires { caseRecord: AchCaseRecord, evidenceBundleIds: string[] }.");
  }
  return { caseRecord: input.caseRecord, evidenceBundleIds: input.evidenceBundleIds };
}

function isCaseFrame(value: unknown): value is CaseFrame {
  return (
    isRecord(value) &&
    typeof value.question === "string" &&
    Array.isArray(value.hypotheses) &&
    value.hypotheses.every((item) => typeof item === "string") &&
    typeof value.nullHypothesis === "string" &&
    value.domain === "defense_supply_chain"
  );
}

function isAchCaseRecord(value: unknown): value is AchCaseRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.question === "string" &&
    Array.isArray(value.hypotheses) &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.assessments)
  );
}

function isEvidenceBundleArray(value: unknown): value is EvidenceBundle[] {
  return Array.isArray(value) && value.every(isEvidenceBundle);
}

function isEvidenceBundle(value: unknown): value is EvidenceBundle {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.knowledgeUnitId === "string" &&
    typeof value.text === "string" &&
    typeof value.source === "string" &&
    typeof value.reliability === "string" &&
    isRecord(value.verdicts)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
