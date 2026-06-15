import { hashPayload } from "./ids.ts";
import type { Claim, EvidenceBundle, KnowledgeUnit, RunOptions, Verdict } from "./types.ts";
import type { SourceVetScenario } from "./sourcevet-types.ts";

export type SourceVetScenarioId =
  | "SV-000-low-risk-independent"
  | "SV-001-independent-corroboration-required"
  | "SV-002-circular-source-lineage";

export const SOURCEVET_SCENARIO_IDS: SourceVetScenarioId[] = [
  "SV-000-low-risk-independent",
  "SV-001-independent-corroboration-required",
  "SV-002-circular-source-lineage"
];

export function createSourceVetScenario(id: SourceVetScenarioId = "SV-001-independent-corroboration-required"): SourceVetScenario {
  if (id === "SV-000-low-risk-independent") return createLowRiskIndependentScenario();
  if (id === "SV-001-independent-corroboration-required") return createIndependentCorroborationRequiredScenario();
  if (id === "SV-002-circular-source-lineage") return createCircularSourceLineageScenario();
  throw new Error(`Unknown SourceVet scenario: ${id}.`);
}

export function createSourceVetScenarios(): SourceVetScenario[] {
  return SOURCEVET_SCENARIO_IDS.map((id) => createSourceVetScenario(id));
}

export function createSourceVetRiskFixture(variant: Extract<RunOptions["fixtureVariant"], "sourcevet_uncorroborated" | "sourcevet_circular">): {
  units: KnowledgeUnit[];
  bundles: EvidenceBundle[];
} {
  const scenario =
    variant === "sourcevet_circular"
      ? createSourceVetScenario("SV-002-circular-source-lineage")
      : createSourceVetScenario("SV-001-independent-corroboration-required");
  return {
    units: scenario.units,
    bundles: scenario.units.map((unit, index) => ({
      id: `eb_${scenario.id}_${index + 1}`,
      knowledgeUnitId: unit.id,
      text: unit.claims.map((claim) => claim.text).join(" "),
      source: unit.sourceUri,
      reliability: unit.reliability ?? "B3",
      verdicts: { ...SOURCEVET_ACH_VERDICTS },
      assumptions: ["SourceVet 회귀검증용 합성 데이터다."],
      unverifiedAreas: ["독립 출처 여부와 순환출처 여부는 SourceVet reviewer가 판단한다."]
    }))
  };
}

export function createLowRiskIndependentScenario(): SourceVetScenario {
  const claimText = "Three independently captured manifests show a controlled decline in actuator imports.";
  const units = [
    makeKnowledgeUnit({
      id: "sv000-source-a",
      sourceUri: "fixture://sourcevet/sv000/manifest-a",
      sourceType: "html",
      reliability: "A2",
      originalLocation: "sv000/manifest-a",
      tags: ["sourcevet", "independent", "manifest"],
      claims: [makeClaim("sv000-claim-a", claimText, 0.91, ["manifest-a-row-7"])]
    }),
    makeKnowledgeUnit({
      id: "sv000-source-b",
      sourceUri: "fixture://sourcevet/sv000/manifest-b",
      sourceType: "api",
      reliability: "B2",
      originalLocation: "sv000/manifest-b",
      tags: ["sourcevet", "independent", "manifest"],
      claims: [makeClaim("sv000-claim-b", claimText, 0.89, ["manifest-b-row-3"])]
    })
  ];

  return {
    id: "SV-000-low-risk-independent",
    title: "Independent sources corroborate a high-confidence claim",
    description: "Two separately captured sources assert the same claim without citing one another.",
    units,
    expected: {
      status: "pass",
      flags: []
    }
  };
}

export function createIndependentCorroborationRequiredScenario(): SourceVetScenario {
  const units = [
    makeKnowledgeUnit({
      id: "sv001-source-a",
      sourceUri: "fixture://sourcevet/sv001/single-report",
      sourceType: "report",
      reliability: "B2",
      originalLocation: "sv001/single-report",
      tags: ["sourcevet", "single-source"],
      claims: [
        makeClaim(
          "sv001-claim-a",
          "A controlled diversion campaign caused the actuator import decline.",
          0.88,
          ["single-report-table-1"]
        )
      ]
    })
  ];

  return {
    id: "SV-001-independent-corroboration-required",
    title: "High-confidence claim lacks independent corroboration",
    description: "A single report asserts a consequential claim without a second independent source.",
    units,
    expected: {
      status: "review_required",
      flags: ["independent-corroboration-required"]
    }
  };
}

export function createCircularSourceLineageScenario(): SourceVetScenario {
  const units = [
    makeKnowledgeUnit({
      id: "sv002-source-a",
      sourceUri: "fixture://sourcevet/sv002/bulletin-a",
      sourceType: "report",
      reliability: "B2",
      originalLocation: "sv002/bulletin-a",
      tags: ["sourcevet", "lineage"],
      claims: [
        makeClaim(
          "sv002-claim-a",
          "Bulletin A repeats the actuator diversion claim from Bulletin B.",
          0.86,
          ["sv002-source-b"]
        )
      ]
    }),
    makeKnowledgeUnit({
      id: "sv002-source-b",
      sourceUri: "fixture://sourcevet/sv002/bulletin-b",
      sourceType: "report",
      reliability: "B2",
      originalLocation: "sv002/bulletin-b",
      tags: ["sourcevet", "lineage"],
      claims: [
        makeClaim(
          "sv002-claim-b",
          "Bulletin B repeats the actuator diversion claim from Bulletin C.",
          0.84,
          ["sv002-source-c"]
        )
      ]
    }),
    makeKnowledgeUnit({
      id: "sv002-source-c",
      sourceUri: "fixture://sourcevet/sv002/bulletin-c",
      sourceType: "report",
      reliability: "B3",
      originalLocation: "sv002/bulletin-c",
      tags: ["sourcevet", "lineage"],
      claims: [
        makeClaim(
          "sv002-claim-c",
          "Bulletin C repeats the actuator diversion claim from Bulletin A.",
          0.83,
          ["sv002-source-a"]
        )
      ]
    })
  ];

  return {
    id: "SV-002-circular-source-lineage",
    title: "Circular source lineage",
    description: "Three reports cite one another in a closed loop, creating apparent corroboration from repeated reporting.",
    units,
    expected: {
      status: "fail",
      flags: ["circular-lineage"]
    }
  };
}

type KnowledgeUnitInput = {
  id: string;
  sourceUri: string;
  sourceType: KnowledgeUnit["sourceType"];
  reliability: string;
  originalLocation: string;
  tags: string[];
  claims: Claim[];
};

function makeKnowledgeUnit(input: KnowledgeUnitInput): KnowledgeUnit {
  return {
    id: input.id,
    sourceUri: input.sourceUri,
    sourceType: input.sourceType,
    extractedAt: "2026-01-01T00:00:00.000Z",
    claims: input.claims,
    provenance: {
      capturedBy: "agent",
      originalLocation: input.originalLocation,
      contentHash: hashPayload(input),
      parserVersion: "sourcevet-fixture-v1"
    },
    reliability: input.reliability,
    tags: input.tags
  };
}

function makeClaim(id: string, text: string, confidence: number, evidenceRefs: string[]): Claim {
  return {
    id,
    text,
    confidence,
    evidenceRefs
  };
}

const SOURCEVET_ACH_VERDICTS: Record<string, Verdict> = {
  "제재 우회 비축": "C",
  "단순 수요 감소": "I",
  "공급망 교란": "C",
  "정상 조달 변동": "N"
};
