import { hashPayload, nowIso } from "../src/agent/ids.ts";
import { buildDynamicCaseFrame } from "../src/agent/dynamic-case-frame.ts";
import { buildEvidenceBundlesForCaseFrame } from "../src/agent/evidence-scoring.ts";
import type { KnowledgeUnit } from "../src/agent/types.ts";

const taiwanPlan = {
  question: "대만 주변 군사 활동 증가는 어떤 시나리오로 설명되는가?",
  domain: "geopolitics",
  hypothesisSet: {
    hypotheses: [
      {
        id: "h1",
        text: "중국이 대만 침공 준비태세를 높이고 있다.",
        indicators: ["대만 상륙함 집결", "동원 대기", "amphibious mobilization"],
        disconfirmingIndicators: ["부대 복귀", "훈련 종료"]
      },
      {
        id: "h2",
        text: "중국이 대만 봉쇄 또는 강압적 군사훈련을 확대하고 있다.",
        indicators: ["대만 항행 경보", "선박 검문", "blockade drill"],
        disconfirmingIndicators: ["항행 정상화", "검문 종료"]
      },
      {
        id: "h3",
        text: "대만 관련 정보작전과 외교 압박을 병행하는 신호전이다.",
        indicators: ["허위 영상", "외교 성명", "influence narrative"],
        disconfirmingIndicators: ["허위 정보 차단", "압박 완화"]
      }
    ]
  },
  nullHypothesis: "대만 주변 활동은 통상적 훈련과 외교적 수사로 설명된다."
};

const frame = buildDynamicCaseFrame(taiwanPlan);
assertIncludes(frame.question, "대만", "case question");
assertAtLeast(frame.hypotheses.length, 3, "dynamic hypothesis count");
assertEveryIncludes([...frame.hypotheses, frame.nullHypothesis], "대만", "dynamic Taiwan hypothesis set");
assertNoLegacySupplyChainHypotheses([...frame.hypotheses, frame.nullHypothesis], "case frame");

const units: KnowledgeUnit[] = [
  makeUnit(
    "ku-taiwan-1",
    "대만 동부 해역 인근에 상륙함과 보급함 집결이 관측됐고 일부 부대의 동원 대기 상태가 보고됐다.",
    ["region:taiwan", "scenario:invasion"]
  ),
  makeUnit(
    "ku-taiwan-2",
    "대만 주변 항행 경보와 선박 검문 훈련 공지가 동시에 늘어 봉쇄 압박 가능성이 제기됐다.",
    ["region:taiwan", "scenario:blockade"]
  ),
  makeUnit(
    "ku-taiwan-3",
    "관영 매체와 외교 성명은 대만 지도부를 압박하는 서사를 반복했고 허위 영상 확산도 확인됐다.",
    ["region:taiwan", "scenario:information"]
  )
];

const bundles = buildEvidenceBundlesForCaseFrame(units, frame, { investigationPlan: taiwanPlan });
assertEqual(bundles.length, units.length, "evidence bundle count");
assertNoLegacySupplyChainHypotheses(
  bundles.flatMap((bundle) => Object.keys(bundle.verdicts)),
  "evidence verdict keys"
);
assertEveryIncludes(
  bundles.flatMap((bundle) => Object.keys(bundle.verdicts)),
  "대만",
  "evidence verdict keys"
);

for (const bundle of bundles) {
  const verdictKeys = Object.keys(bundle.verdicts);
  assertEqual(verdictKeys.length, frame.hypotheses.length + 1, `${bundle.id} verdict key count`);
  for (const hypothesis of [...frame.hypotheses, frame.nullHypothesis]) {
    assertIncludes(verdictKeys.join("\n"), hypothesis, `${bundle.id} dynamic verdict key`);
  }
}

assertEqual(bundles[0].verdicts[frame.hypotheses[0]], "C", "invasion evidence scores against invasion hypothesis");
assertEqual(bundles[1].verdicts[frame.hypotheses[1]], "C", "blockade evidence scores against blockade hypothesis");
assertEqual(bundles[2].verdicts[frame.hypotheses[2]], "C", "information evidence scores against information hypothesis");

console.log("WARDEN dynamic case frame regression: passed");

function makeUnit(id: string, text: string, tags: string[]): KnowledgeUnit {
  return {
    id,
    sourceUri: `fixture://taiwan/${id}`,
    sourceType: "fixture",
    extractedAt: nowIso(),
    claims: [
      {
        id: `claim-${id}`,
        text,
        confidence: 0.82,
        evidenceRefs: [`fixture-${id}`]
      }
    ],
    provenance: {
      capturedBy: "agent",
      originalLocation: `taiwan-dynamic-fixture#${id}`,
      contentHash: hashPayload({ id, text, tags }),
      parserVersion: "dynamic-case-frame-regression-v1"
    },
    reliability: "B2",
    tags
  };
}

function assertNoLegacySupplyChainHypotheses(values: string[], label: string): void {
  const legacyHypotheses = ["제재 우회 비축", "단순 수요 감소", "공급망 교란", "정상 조달 변동"];
  for (const value of values) {
    for (const legacy of legacyHypotheses) {
      if (value.includes(legacy)) {
        throw new Error(`${label} unexpectedly included legacy supply-chain hypothesis: ${legacy}`);
      }
    }
  }
}

function assertEveryIncludes(values: string[], expected: string, label: string): void {
  for (const value of values) {
    assertIncludes(value, expected, label);
  }
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) {
    throw new Error(`${label} failed: expected at least ${expected} actual=${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
