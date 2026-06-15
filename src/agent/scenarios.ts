import { hashPayload, newId, nowIso } from "./ids.ts";
import type { CaseFrame, EvidenceBundle, KnowledgeUnit } from "./types.ts";

export function createSupplyChainCaseFrame(): CaseFrame {
  return {
    question: "방산 핵심 부품 수입 급감의 원인은 무엇인가?",
    hypotheses: ["제재 우회 비축", "단순 수요 감소", "공급망 교란"],
    nullHypothesis: "정상 조달 변동",
    domain: "defense_supply_chain"
  };
}

export function createSupplyChainKnowledgeFixture(variant: "normal" | "missing_reliability" = "normal"): {
  units: KnowledgeUnit[];
  bundles: EvidenceBundle[];
} {
  const extractedAt = nowIso();
  const rows = [
    {
      text: "핵심 부품 수입량이 3개월 연속 급감했다.",
      source: "합성 통관 통계",
      reliability: variant === "missing_reliability" ? "" : "B2",
      verdicts: {
        "제재 우회 비축": "C",
        "단순 수요 감소": "C",
        "공급망 교란": "C",
        "정상 조달 변동": "C"
      },
      tags: ["import", "supply-chain"]
    },
    {
      text: "동일 부품의 제3국 경유 물동량이 증가했다.",
      source: "합성 물류 관측",
      reliability: "B2",
      verdicts: {
        "제재 우회 비축": "C",
        "단순 수요 감소": "I",
        "공급망 교란": "C",
        "정상 조달 변동": "I"
      },
      tags: ["transshipment", "logistics"]
    },
    {
      text: "완제품 생산라인 가동률은 유지되고 있다.",
      source: "합성 생산지표",
      reliability: "A2",
      verdicts: {
        "제재 우회 비축": "C",
        "단순 수요 감소": "I",
        "공급망 교란": "N",
        "정상 조달 변동": "N"
      },
      tags: ["production"]
    },
    {
      text: "관련 수출통제 문구가 최근 강화됐다.",
      source: "합성 규제 공지",
      reliability: "B3",
      verdicts: {
        "제재 우회 비축": "C",
        "단순 수요 감소": "N",
        "공급망 교란": "C",
        "정상 조달 변동": "I"
      },
      tags: ["export-control"]
    },
    {
      text: "주요 수요처의 발주 취소 공시는 확인되지 않았다.",
      source: "합성 공시 모니터",
      reliability: "C3",
      verdicts: {
        "제재 우회 비축": "N",
        "단순 수요 감소": "I",
        "공급망 교란": "N",
        "정상 조달 변동": "N"
      },
      tags: ["demand"]
    }
  ] as const;

  const units: KnowledgeUnit[] = rows.map((row, index) => {
    const id = newId("ku");
    return {
      id,
      sourceUri: `fixture://supply-chain/${index + 1}`,
      sourceType: "fixture",
      extractedAt,
      claims: [
        {
          id: newId("claim"),
          text: row.text,
          confidence: row.reliability ? 0.82 : 0.2,
          evidenceRefs: [`fixture-row-${index + 1}`]
        }
      ],
      provenance: {
        capturedBy: "agent",
        originalLocation: `supply-chain-fixture#${index + 1}`,
        contentHash: hashPayload(row),
        parserVersion: "fixture-v1"
      },
      reliability: row.reliability,
      tags: [...row.tags]
    };
  });

  const bundles: EvidenceBundle[] = rows.map((row, index) => ({
    id: newId("eb"),
    knowledgeUnitId: units[index].id,
    text: row.text,
    source: row.source,
    reliability: row.reliability,
    verdicts: { ...row.verdicts },
    assumptions: ["합성 데이터이며 실작전 또는 실기업 데이터가 아니다."],
    unverifiedAreas: ["제3국 경유 물량의 최종 수하인은 P0 fixture에서 확인하지 않는다."]
  }));

  return { units, bundles };
}
