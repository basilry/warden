import { renderVerificationReport } from "./verifiers.ts";
import type { SourceReview } from "./sourcevet-types.ts";
import type { AchAnalysisResult, AuditBrief, PolicyReviewReport, TraceSummary, VerificationReport } from "./types.ts";

export function createAuditBrief(input: {
  ach: AchAnalysisResult;
  verification: VerificationReport;
  traceSummary: TraceSummary;
  sourceReview?: SourceReview;
  policyReview?: PolicyReviewReport;
}): AuditBrief {
  return {
    title: input.sourceReview ? "WARDEN P2 감사 브리프: 방산 공급망 이상징후 분석" : "WARDEN P0 감사 브리프: 방산 공급망 이상징후 분석",
    question: input.ach.question,
    survivorSummary: `생존 가설: ${input.ach.survivors.join(", ")}`,
    rfiSummary: input.ach.rfi,
    agentContributions: [
      { role: "supervisor", summary: "고정 P0 팀 워크플로를 선택하고 종료 조건을 관리했다." },
      { role: "case_framer", summary: "사용자 요청을 ACH 질문, 경쟁가설, 귀무가설로 구조화했다." },
      { role: "evidence_curator", summary: "합성 fixture를 provenance가 있는 KnowledgeUnit과 EvidenceBundle로 정리했다." },
      ...(input.policyReview
        ? [{ role: "policy_reviewer" as const, summary: `ACH tool plan을 사전 검토했다: ${input.policyReview.status}.` }]
        : []),
      ...(input.sourceReview
        ? [{ role: "sourcevet_reviewer" as const, summary: `출처 신뢰도와 lineage를 검토했다: ${input.sourceReview.status}.` }]
        : []),
      { role: "ach_analyst", summary: "정책 통과 후 결정적 ACH 로컬 도구로 matrix, ranking, RFI를 산출했다." },
      { role: "verifier", summary: "가설 수, 신뢰도, matrix 완전성, trace/policy 우회를 독립 검증했다." },
      { role: "briefing", summary: "검증 통과 결과만 감사 가능한 브리프로 정리했다." }
    ],
    verificationSummary: `Verification ${input.verification.status}. ${input.verification.checks.length} checks executed.`,
    sourceRiskSummary: input.sourceReview
      ? `SourceVet ${input.sourceReview.status}; flags=${input.sourceReview.flags.map((flag) => `${flag.code}:${flag.severity}`).join(", ") || "none"}`
      : undefined,
    policyReviewSummary: input.policyReview ? input.policyReview.summary : undefined,
    traceSummary: `${input.traceSummary.eventCount} trace events, ${input.traceSummary.toolCalls.length} tool calls, policy decisions: ${JSON.stringify(input.traceSummary.policyDecisions)}`,
    residualRisk: input.verification.residualRisk
  };
}

export function renderAuditBriefMarkdown(
  brief: AuditBrief,
  input?: { ach?: AchAnalysisResult; verification?: VerificationReport; sourceReview?: SourceReview }
): string {
  const sections = [
    `# ${brief.title}`,
    `## 분석 질문\n${brief.question}`,
    `## 결정적 분석 결과\n${brief.survivorSummary}`,
    brief.rfiSummary ? `## RFI\n${brief.rfiSummary}` : undefined,
    input?.ach ? `## ACH 순위\n${renderRanking(input.ach)}` : undefined,
    input?.ach ? `## 변별력\n${renderDiagnosticity(input.ach)}` : undefined,
    brief.policyReviewSummary ? `## 정책 리뷰\n${brief.policyReviewSummary}` : undefined,
    brief.sourceRiskSummary ? `## SourceVet 출처 리뷰\n${brief.sourceRiskSummary}` : undefined,
    input?.sourceReview ? `## SourceVet 플래그\n${renderSourceFlags(input.sourceReview)}` : undefined,
    `## 에이전트 기여\n${brief.agentContributions.map((item) => `- ${item.role}: ${item.summary}`).join("\n")}`,
    input?.verification ? `## 독립 검증\n${renderVerificationReport(input.verification)}` : `## 독립 검증\n${brief.verificationSummary}`,
    `## Trace 요약\n${brief.traceSummary}`,
    `## 잔여 리스크\n${brief.residualRisk.map((risk) => `- ${risk}`).join("\n")}`
  ];

  return sections.filter(Boolean).join("\n\n");
}

function renderSourceFlags(review: SourceReview): string {
  if (review.flags.length === 0) return "No SourceVet risk flags.";
  return review.flags.map((flag) => `- [${flag.severity}] ${flag.code}: ${flag.summary}`).join("\n");
}

function renderRanking(result: AchAnalysisResult): string {
  return result.ranked
    .map(
      (score, index) =>
        `${index + 1}. ${score.hypothesis} - contradictions=${score.contradictions}, support=${score.support}, status=${score.status}`
    )
    .join("\n");
}

function renderDiagnosticity(result: AchAnalysisResult): string {
  return result.diagnosticity
    .map((score) => `- ${score.evidence}: diagnosticity=${score.diagnosticity} (${score.note})`)
    .join("\n");
}
