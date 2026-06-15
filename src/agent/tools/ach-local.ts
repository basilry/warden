import { newId } from "../ids.ts";
import type {
  AchAnalysisResult,
  AchCaseRecord,
  CaseFrame,
  DiagnosticityScore,
  Evidence,
  EvidenceBundle,
  Hypothesis,
  HypothesisScore,
  MatrixCell,
  Verdict
} from "../types.ts";

export type AchLocalTool = {
  openCaseFromFrame(frame: CaseFrame): AchCaseRecord;
  addEvidenceFromBundles(caseRecord: AchCaseRecord, bundles: EvidenceBundle[]): AchCaseRecord;
  assessFromBundles(caseRecord: AchCaseRecord, bundles: EvidenceBundle[]): AchCaseRecord;
  buildAchAnalysisResult(caseRecord: AchCaseRecord, bundleIds: string[]): AchAnalysisResult;
};

export function createAchLocalTool(): AchLocalTool {
  return {
    openCaseFromFrame,
    addEvidenceFromBundles,
    assessFromBundles,
    buildAchAnalysisResult
  };
}

export function openCaseFromFrame(frame: CaseFrame): AchCaseRecord {
  const hypotheses: Hypothesis[] = [
    ...frame.hypotheses.map((text) => ({ id: newId("h"), text, isNull: false })),
    { id: newId("h"), text: frame.nullHypothesis, isNull: true }
  ];

  if (hypotheses.length < 3) {
    throw new Error("ACH gate rejected case: at least three competing hypotheses are required.");
  }

  return {
    id: newId("case"),
    question: frame.question,
    hypotheses,
    evidence: [],
    assessments: []
  };
}

export function addEvidenceFromBundles(caseRecord: AchCaseRecord, bundles: EvidenceBundle[]): AchCaseRecord {
  const evidence: Evidence[] = bundles.map((bundle) => {
    assertReliability(bundle.reliability, bundle.id);
    return {
      id: newId("e"),
      text: bundle.text,
      source: bundle.source,
      reliability: bundle.reliability,
      weight: reliabilityWeight(bundle.reliability)
    };
  });

  return {
    ...caseRecord,
    evidence: [...caseRecord.evidence, ...evidence]
  };
}

export function assessFromBundles(caseRecord: AchCaseRecord, bundles: EvidenceBundle[]): AchCaseRecord {
  if (caseRecord.evidence.length !== bundles.length) {
    throw new Error("ACH gate rejected assessment: evidence and bundle counts differ.");
  }

  const assessments: MatrixCell[] = [];

  for (const evidence of caseRecord.evidence) {
    const bundle = bundles[caseRecord.evidence.indexOf(evidence)];
    for (const hypothesis of caseRecord.hypotheses) {
      const verdict = bundle.verdicts[hypothesis.text];
      if (!isVerdict(verdict)) {
        throw new Error(`ACH gate rejected assessment: missing C/I/N verdict for "${hypothesis.text}".`);
      }
      assessments.push({
        evidenceId: evidence.id,
        hypothesisId: hypothesis.id,
        verdict
      });
    }
  }

  assertMatrixComplete({ ...caseRecord, assessments });
  return { ...caseRecord, assessments };
}

export function buildAchAnalysisResult(caseRecord: AchCaseRecord, bundleIds: string[]): AchAnalysisResult {
  assertMatrixComplete(caseRecord);
  const ranked = rankHypotheses(caseRecord);
  const bestContradictions = ranked[0]?.contradictions ?? 0;
  const survivors = ranked
    .filter((score) => score.contradictions === bestContradictions)
    .map((score) => score.hypothesis);

  return {
    caseId: caseRecord.id,
    question: caseRecord.question,
    matrix: renderMatrix(caseRecord),
    ranked,
    diagnosticity: computeDiagnosticity(caseRecord),
    survivors,
    rfi: suggestRfi(survivors),
    evidenceBundleIds: bundleIds,
    caseRecord
  };
}

export function rankHypotheses(caseRecord: AchCaseRecord): HypothesisScore[] {
  const scores = caseRecord.hypotheses.map((hypothesis) => {
    const cells = caseRecord.assessments.filter((cell) => cell.hypothesisId === hypothesis.id);
    let contradictions = 0;
    let support = 0;
    let neutral = 0;

    for (const cell of cells) {
      const evidence = caseRecord.evidence.find((item) => item.id === cell.evidenceId);
      const weight = evidence?.weight ?? 1;
      if (cell.verdict === "I") contradictions += weight;
      if (cell.verdict === "C") support += weight;
      if (cell.verdict === "N") neutral += weight;
    }

    return {
      hypothesisId: hypothesis.id,
      hypothesis: hypothesis.text,
      contradictions: round(contradictions),
      support: round(support),
      neutral: round(neutral),
      status: "challenged" as const
    };
  });

  const minContradictions = Math.min(...scores.map((score) => score.contradictions));
  return scores
    .map((score) => ({
      ...score,
      status: score.contradictions === minContradictions ? ("survivor" as const) : ("challenged" as const)
    }))
    .sort((a, b) => a.contradictions - b.contradictions || b.support - a.support || a.hypothesis.localeCompare(b.hypothesis));
}

export function computeDiagnosticity(caseRecord: AchCaseRecord): DiagnosticityScore[] {
  return caseRecord.evidence.map((evidence) => {
    const verdicts = caseRecord.assessments
      .filter((cell) => cell.evidenceId === evidence.id)
      .map((cell) => cell.verdict);
    const unique = new Set(verdicts);
    const diagnosticity = unique.size <= 1 ? 0 : round(evidence.weight * unique.size);
    return {
      evidenceId: evidence.id,
      evidence: evidence.text,
      diagnosticity,
      note: diagnosticity === 0 ? "모든 가설에 같은 방향이라 변별력이 없다." : "가설 간 차이를 만든다."
    };
  });
}

export function renderMatrix(caseRecord: AchCaseRecord): string {
  const header = ["Evidence", ...caseRecord.hypotheses.map((hypothesis) => hypothesis.text)].join(" | ");
  const separator = ["---", ...caseRecord.hypotheses.map(() => "---")].join(" | ");
  const rows = caseRecord.evidence.map((evidence) => {
    const cells = caseRecord.hypotheses.map((hypothesis) => {
      return caseRecord.assessments.find((cell) => cell.evidenceId === evidence.id && cell.hypothesisId === hypothesis.id)
        ?.verdict ?? "?";
    });
    return [evidence.text, ...cells].join(" | ");
  });
  return [header, separator, ...rows].join("\n");
}

export function assertMatrixComplete(caseRecord: AchCaseRecord): void {
  for (const evidence of caseRecord.evidence) {
    for (const hypothesis of caseRecord.hypotheses) {
      const found = caseRecord.assessments.some(
        (cell) => cell.evidenceId === evidence.id && cell.hypothesisId === hypothesis.id && isVerdict(cell.verdict)
      );
      if (!found) {
        throw new Error(`ACH gate rejected ranking: missing assessment for ${evidence.id}/${hypothesis.id}.`);
      }
    }
  }
}

export function isValidReliability(reliability: string | undefined): boolean {
  return /^[A-F][1-6]$/.test(reliability ?? "");
}

function assertReliability(reliability: string, ref: string): void {
  if (!isValidReliability(reliability)) {
    throw new Error(`ACH gate rejected evidence ${ref}: Admiralty reliability code [A-F][1-6] is required.`);
  }
}

function reliabilityWeight(reliability: string): number {
  const sourceReliability = { A: 1, B: 0.85, C: 0.65, D: 0.45, E: 0.25, F: 0.1 }[reliability[0]] ?? 0.1;
  const informationCredibility = { "1": 1, "2": 0.85, "3": 0.65, "4": 0.45, "5": 0.25, "6": 0.1 }[
    reliability[1]
  ] ?? 0.1;
  return round((sourceReliability + informationCredibility) / 2);
}

function isVerdict(value: unknown): value is Verdict {
  return value === "C" || value === "I" || value === "N";
}

function suggestRfi(survivors: string[]): string | undefined {
  if (survivors.length <= 1) {
    return "잔여 리스크 확인: 제3국 경유 물량의 최종 수하인과 재고 이동 기록을 추가 확인한다.";
  }
  return `생존 가설(${survivors.join(", ")})을 가르기 위해 제3국 경유 물량의 최종 수하인, 대체 공급처 장애 보고, 재고 이동 기록을 확인한다.`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
