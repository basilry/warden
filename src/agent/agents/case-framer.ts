import { caseFrameFromInvestigationPlan } from "../dynamic-case-frame.ts";
import { createSupplyChainCaseFrame } from "../scenarios.ts";
import type { Agent, CaseFrame } from "../types.ts";
import { createHandoff } from "./base.ts";

export function createCaseFramerAgent(): Agent<string, CaseFrame> {
  return {
    role: "case_framer",
    async run(task, context) {
      const frame = caseFrameFromInvestigationPlan(context.options.investigationPlan) ?? createSupplyChainCaseFrame();
      return {
        status: "succeeded",
        output: frame,
        summary: `Framed question with ${frame.hypotheses.length} hypotheses plus null hypothesis.`,
        handoffs: [
          createHandoff("case_framer", "evidence_curator", task.id, ["case-frame"], "CaseFrame ready for evidence curation.")
        ]
      };
    }
  };
}
