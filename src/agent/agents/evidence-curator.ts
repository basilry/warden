import { mapKnowledgeUnitsToEvidenceBundles } from "../evidence-scoring.ts";
import { createSupplyChainKnowledgeFixture } from "../scenarios.ts";
import { createSourceVetRiskFixture } from "../sourcevet-scenarios.ts";
import type { Agent, CaseFrame, EvidenceBundle, KnowledgeUnit } from "../types.ts";
import { createHandoff } from "./base.ts";

export type EvidenceCuratorOutput = {
  units: KnowledgeUnit[];
  bundles: EvidenceBundle[];
};

export function createEvidenceCuratorAgent(): Agent<unknown, EvidenceCuratorOutput> {
  return {
    role: "evidence_curator",
    async run(task, context, input) {
      const dynamicFrame = readDynamicFrame(input, context.options.investigationPlan);
      if (dynamicFrame) {
        const output = createDynamicEvidenceOutput(
          dynamicFrame,
          context.options.investigationPlan,
          context.options.extraKnowledgeUnits,
          context.options.extraEvidenceBundles
        );
        return {
          status: "succeeded",
          output,
          summary: `Curated ${output.units.length} dynamic KnowledgeUnit(s) and ${output.bundles.length} EvidenceBundle(s).`,
          handoffs: [
            createHandoff(
              "evidence_curator",
              "ach_analyst",
              task.id,
              ["knowledge-units", "evidence-bundles"],
              "Dynamic evidence bundles ready for ACH analysis."
            )
          ]
        };
      }

      if (
        context.options.fixtureVariant === "sourcevet_uncorroborated" ||
        context.options.fixtureVariant === "sourcevet_circular"
      ) {
        const output = mergeExtraEvidence(
          createSourceVetRiskFixture(context.options.fixtureVariant),
          context.options.extraKnowledgeUnits,
          context.options.extraEvidenceBundles
        );
        return {
          status: "succeeded",
          output,
          summary: `Curated ${output.units.length} SourceVet risk fixture KnowledgeUnit(s).`,
          handoffs: [
            createHandoff(
              "evidence_curator",
              "sourcevet_reviewer",
              task.id,
              ["knowledge-units", "evidence-bundles"],
              "Evidence bundles ready for SourceVet review."
            )
          ]
        };
      }

      const variant = context.options.fixtureVariant === "missing_reliability" ? "missing_reliability" : "normal";
      const output = mergeExtraEvidence(
        createSupplyChainKnowledgeFixture(variant),
        context.options.extraKnowledgeUnits,
        context.options.extraEvidenceBundles
      );
      return {
        status: "succeeded",
        output,
        summary: `Curated ${output.units.length} KnowledgeUnits and ${output.bundles.length} EvidenceBundles from fixture data.`,
        handoffs: [
          createHandoff("evidence_curator", "ach_analyst", task.id, ["knowledge-units", "evidence-bundles"], "Evidence bundles ready for ACH analysis.")
        ]
      };
    }
  };
}

function readDynamicFrame(input: unknown, investigationPlan: unknown): CaseFrame | undefined {
  if (!investigationPlan || !isCaseFrame(input)) return undefined;
  return input;
}

function createDynamicEvidenceOutput(
  frame: CaseFrame,
  investigationPlan: unknown,
  extraUnits: KnowledgeUnit[] = [],
  extraBundles: EvidenceBundle[] = []
): EvidenceCuratorOutput {
  if (extraUnits.length > 0) {
    return mergeExtraEvidence(
      {
        units: [],
        bundles: mapKnowledgeUnitsToEvidenceBundles(extraUnits, frame, {
          investigationPlan,
          assumption: "승인 또는 로컬 검색으로 확보한 KnowledgeUnit을 dynamic ACH frame에 매핑했다.",
          unverifiedArea: "자동 evidence verdict mapping은 analyst review 전 단계다."
        })
      },
      [],
      extraBundles
    );
  }

  return {
    units: [],
    bundles: []
  };
}

function mergeExtraEvidence(
  base: EvidenceCuratorOutput,
  extraUnits: KnowledgeUnit[] = [],
  extraBundles: EvidenceBundle[] = []
): EvidenceCuratorOutput {
  if (extraUnits.length === 0 && extraBundles.length === 0) return base;
  return {
    units: [...base.units, ...extraUnits],
    bundles: [...base.bundles, ...extraBundles]
  };
}

function isCaseFrame(value: unknown): value is CaseFrame {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "question" in value &&
      typeof value.question === "string" &&
      "hypotheses" in value &&
      Array.isArray(value.hypotheses) &&
      "nullHypothesis" in value &&
      typeof value.nullHypothesis === "string"
  );
}
