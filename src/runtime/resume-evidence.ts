import { hashPayload } from "../agent/ids.ts";
import type { AchCaseRecord, EvidenceBundle, KnowledgeUnit, Verdict } from "../agent/types.ts";
import type { SourceReview } from "../agent/sourcevet-types.ts";

export type EvidencePromotionResult = {
  promotedUnits: KnowledgeUnit[];
  promotedBundles: EvidenceBundle[];
  rejectedUnits: string[];
};

export function promoteSourceVettedUnitsToBundles(
  units: KnowledgeUnit[],
  sourceReview: SourceReview,
  achCase: AchCaseRecord | undefined
): EvidencePromotionResult {
  const rejected = new Set(
    sourceReview.sourceAssessments
      .filter((assessment) => assessment.flags.some((flag) => shouldRejectFlag(flag, sourceReview)))
      .map((assessment) => assessment.sourceId)
  );
  const promotedUnits = units.filter((unit) => !rejected.has(unit.id));
  return {
    promotedUnits,
    promotedBundles: promotedUnits.map((unit, index) => buildEvidenceBundle(unit, achCase, index)),
    rejectedUnits: [...rejected]
  };
}

function shouldRejectFlag(flag: SourceReview["flags"][number], sourceReview: SourceReview): boolean {
  if (flag.severity === "critical") return true;
  if (flag.severity !== "high") return false;
  if (flag.code === "independent-corroboration-required") {
    return sourceReview.independentCorroboration.status !== "pass";
  }
  return true;
}

function buildEvidenceBundle(unit: KnowledgeUnit, achCase: AchCaseRecord | undefined, index: number): EvidenceBundle {
  const text = unit.claims.map((claim) => claim.text).join(" ");
  return {
    id: `eb_resume_${hashPayload({ unitId: unit.id, text, index }).slice(0, 12)}`,
    knowledgeUnitId: unit.id,
    text,
    source: unit.sourceUri,
    reliability: normalizeReliability(unit.reliability),
    verdicts: buildConservativeVerdicts(text, achCase),
    assumptions: [
      "승인 후 fetch된 근거를 SourceVet 검토 뒤 ACH 재평가에 보수적으로 승격했다.",
      "자동 verdict는 운영 결론이 아니라 resume regression용 초기 규칙이다."
    ],
    unverifiedAreas: ["실제 외부 OSINT connector와 analyst-confirmed verdict mapping은 다음 단계에서 강화해야 한다."]
  };
}

function buildConservativeVerdicts(text: string, achCase: AchCaseRecord | undefined): Record<string, Verdict> {
  const hypotheses = achCase?.hypotheses.map((hypothesis) => hypothesis.text) ?? [
    "제재 우회 비축",
    "단순 수요 감소",
    "공급망 교란",
    "정상 조달 변동"
  ];
  const verdicts: Record<string, Verdict> = {};
  for (const hypothesis of hypotheses) {
    verdicts[hypothesis] = inferVerdict(text, hypothesis);
  }
  return verdicts;
}

function inferVerdict(text: string, hypothesis: string): Verdict {
  const normalized = `${text} ${hypothesis}`;
  if (hypothesis.includes("제재") || hypothesis.includes("비축")) {
    return /제재|수출통제|비축|우회|전략물자/.test(normalized) ? "C" : "N";
  }
  if (hypothesis.includes("공급망") || hypothesis.includes("교란")) {
    return /공급망|교란|물류|병목|수급|통제/.test(normalized) ? "C" : "N";
  }
  if (hypothesis.includes("수요")) {
    return /생산|수요|발주/.test(normalized) ? "I" : "N";
  }
  if (hypothesis.includes("정상")) {
    return /리스크|교란|제재|통제|병목|우회/.test(normalized) ? "I" : "N";
  }
  return "N";
}

function normalizeReliability(reliability: string | undefined): string {
  return /^[A-F][1-6]$/.test(reliability ?? "") ? reliability! : "C3";
}
