import type { AchAnalysisResult, AchCaseRecord, CaseFrame, EvidenceBundle, Risk } from "../../agent/types.ts";

export const ACH_MCP_TOOL_NAMES = ["open_case", "add_evidence", "assess", "rank_hypotheses"] as const;

export type AchMcpToolName = (typeof ACH_MCP_TOOL_NAMES)[number];

export type OpenCaseInput = {
  frame: CaseFrame;
};

export type OpenCaseOutput = {
  caseRecord: AchCaseRecord;
};

export type AddEvidenceInput = {
  caseRecord: AchCaseRecord;
  bundles: EvidenceBundle[];
};

export type AddEvidenceOutput = {
  caseRecord: AchCaseRecord;
};

export type AssessInput = {
  caseRecord: AchCaseRecord;
  bundles: EvidenceBundle[];
};

export type AssessOutput = {
  caseRecord: AchCaseRecord;
};

export type RankHypothesesInput = {
  caseRecord: AchCaseRecord;
  evidenceBundleIds: string[];
};

export type RankHypothesesOutput = {
  result: AchAnalysisResult;
};

export type AchMcpInputByTool = {
  open_case: OpenCaseInput;
  add_evidence: AddEvidenceInput;
  assess: AssessInput;
  rank_hypotheses: RankHypothesesInput;
};

export type AchMcpOutputByTool = {
  open_case: OpenCaseOutput;
  add_evidence: AddEvidenceOutput;
  assess: AssessOutput;
  rank_hypotheses: RankHypothesesOutput;
};

export function getAchMcpToolRisk(toolName: AchMcpToolName): Risk {
  return toolName === "rank_hypotheses" ? "READ" : "WRITE";
}

export function isAchMcpToolName(value: string): value is AchMcpToolName {
  return (ACH_MCP_TOOL_NAMES as readonly string[]).includes(value);
}
