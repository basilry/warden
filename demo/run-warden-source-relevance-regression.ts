import type { KnowledgeUnit } from "../src/agent/types.ts";
import { buildInvestigationPlan } from "../src/runtime/investigation-planner.ts";
import { filterRelevantKnowledgeUnits } from "../src/runtime/source-relevance.ts";

const objective = "이재명 대통령의 북중러 친밀도 강화와 반미 정책에 대한 미국의 반응";
const investigationPlan = buildInvestigationPlan(objective);

const units: KnowledgeUnit[] = [
  createUnit({
    id: "relevant-reuters",
    sourceUri: "https://www.reuters.com/world/asia-pacific/south-korea-us-alliance-china-policy",
    title: "South Korea, US discuss alliance response to China and North Korea policy",
    summary: "Reuters reports on US State Department and South Korea alliance coordination over China, North Korea, Russia and Lee Jae-myung foreign policy.",
    publisher: "reuters.com",
    tags: ["live-osint", "reuters", "us-alliance"]
  }),
  createUnit({
    id: "irrelevant-accident",
    sourceUri: "https://example.com/local-weather-traffic-accident",
    title: "Local traffic accident disrupts morning commute",
    summary: "A local traffic update about rain, road closures, and bus delays.",
    publisher: "example.com",
    tags: ["live-osint", "accident"]
  })
];

const result = filterRelevantKnowledgeUnits(units, {
  objective,
  investigationPlan,
  minimumScore: 0.28
});

assertIncludes(
  result.accepted.map((unit) => unit.id).join(","),
  "relevant-reuters",
  "relevant alliance source should be accepted"
);
assertIncludes(
  result.rejected.map((unit) => unit.id).join(","),
  "irrelevant-accident",
  "irrelevant source should be rejected"
);
assertIncludes(result.warnings.join("\n"), "ACH 판단 근거에서 제외", "relevance warning");

console.log("WARDEN source relevance regression: passed");

function createUnit(input: {
  id: string;
  sourceUri: string;
  title: string;
  summary: string;
  publisher: string;
  tags: string[];
}): KnowledgeUnit {
  return {
    id: input.id,
    sourceUri: input.sourceUri,
    sourceType: "html",
    extractedAt: "2026-06-18T00:00:00.000Z",
    reliability: "B2",
    tags: input.tags,
    metadata: {
      title: input.title,
      summary: input.summary,
      publisher: input.publisher
    },
    claims: [
      {
        id: `${input.id}:claim:1`,
        text: input.summary,
        confidence: 0.74,
        evidenceRefs: [input.sourceUri]
      }
    ],
    provenance: {
      capturedBy: "connector",
      originalLocation: input.sourceUri,
      contentHash: input.id,
      parserVersion: "source-relevance-regression"
    }
  };
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}
