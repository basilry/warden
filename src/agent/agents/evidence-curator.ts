import { createSupplyChainKnowledgeFixture } from "../scenarios.ts";
import { createSourceVetRiskFixture } from "../sourcevet-scenarios.ts";
import type { Agent, EvidenceBundle, KnowledgeUnit } from "../types.ts";
import { createHandoff } from "./base.ts";

export type EvidenceCuratorOutput = {
  units: KnowledgeUnit[];
  bundles: EvidenceBundle[];
};

export function createEvidenceCuratorAgent(): Agent<unknown, EvidenceCuratorOutput> {
  return {
    role: "evidence_curator",
    async run(task, context) {
      if (
        context.options.fixtureVariant === "sourcevet_uncorroborated" ||
        context.options.fixtureVariant === "sourcevet_circular"
      ) {
        const output = createSourceVetRiskFixture(context.options.fixtureVariant);
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
      const output = createSupplyChainKnowledgeFixture(variant);
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
