import type { ApprovalRequest } from "../agent/approval.ts";
import type { ModelResponse } from "../agent/model-adapter.ts";
import type { TeamRunResult } from "../agent/types.ts";
import type { RuntimeRunStatus } from "./types.ts";

export type RuntimeAnswer = {
  title: string;
  directAnswer: string;
  keyFindings: string[];
  evidenceUsed: string[];
  uncertainty: string[];
  blockedActions: string[];
  nextSteps: string[];
  authorityRefs: string[];
  warnings: string[];
};

export type AnswerContext = {
  objective: string;
  runStatus: RuntimeRunStatus;
  teamResult?: TeamRunResult;
  approvals: ApprovalRequest[];
  modelResponses: ModelResponse[];
};

export function composeDeterministicAnswer(context: AnswerContext): RuntimeAnswer {
  const ach = context.teamResult?.outputs.ach;
  const verification = context.teamResult?.outputs.verification;
  const sourceReview = context.teamResult?.outputs.sourceReview;
  const pendingApprovals = context.approvals.filter((approval) => approval.status === "pending");
  const survivors = ach?.survivors ?? [];
  const evidence = ach?.caseRecord.evidence ?? [];

  const keyFindings =
    ach && survivors.length > 0
      ? ach.ranked
          .filter((score) => score.status === "survivor")
          .map(
            (score) =>
              `${score.hypothesis}: 현재 ACH 생존 가설입니다. support=${score.support}, contradictions=${score.contradictions}.`
          )
      : ["아직 검증된 생존 가설이 없습니다. 먼저 분석 팀 실행 결과가 필요합니다."];

  const uncertainty = [
    ...((verification?.residualRisk ?? []).length > 0
      ? verification?.residualRisk ?? []
      : ["현재 답변은 WARDEN 로컬 분석 결과에 제한됩니다."]),
    ...(sourceReview?.flags.map((flag) => `SourceVet ${flag.severity}: ${flag.summary}`) ?? []),
    ...(pendingApprovals.length > 0 ? ["외부 OSINT 수집은 승인 전이라 답변 근거에 반영되지 않았습니다."] : [])
  ];

  return {
    title: context.objective,
    directAnswer: buildDirectAnswer(context.objective, survivors, pendingApprovals.length),
    keyFindings,
    evidenceUsed:
      evidence.length > 0
        ? evidence.slice(0, 5).map((item) => `${item.text} (${item.source}, reliability=${item.reliability})`)
        : ["아직 답변에 사용할 구조화 evidence가 없습니다."],
    uncertainty: uniqueNonEmpty(uncertainty),
    blockedActions: pendingApprovals.map(
      (approval) => `${approval.action.name}: ${approval.reason} (${approval.decision.risk})`
    ),
    nextSteps: buildNextSteps(ach?.rfi, pendingApprovals),
    authorityRefs: buildAuthorityRefs(context),
    warnings: buildWarnings(context)
  };
}

function buildDirectAnswer(objective: string, survivors: string[], pendingApprovalCount: number): string {
  if (survivors.length === 0) {
    return [
      `질문 "${objective}"에 대해 아직 확정 가능한 WARDEN 분석 결과가 없습니다.`,
      "분석 팀 실행, ACH 평가, 검증 결과가 준비되어야 답변을 만들 수 있습니다."
    ].join(" ");
  }

  const survivorText = survivors.join(", ");
  const approvalText =
    pendingApprovalCount > 0
      ? "다만 외부 정보 수집은 승인 대기 상태라, 현재 답변은 로컬/fixture 기반 근거에 한정됩니다."
      : "현재 승인 대기 중인 외부 수집은 없습니다.";

  return [
    `질문 "${objective}"에 대해 WARDEN의 현재 통제 분석에서는 ${survivorText} 가설이 생존했습니다.`,
    "이는 확정 결론이 아니라 ACH, 정책 게이트, 검증자가 허용한 범위의 중간 분석입니다.",
    approvalText
  ].join(" ");
}

function buildNextSteps(rfi: string | undefined, pendingApprovals: ApprovalRequest[]): string[] {
  return uniqueNonEmpty([
    rfi,
    ...pendingApprovals.map((approval) => `${approval.action.name} 승인 여부를 결정한 뒤 같은 run을 재개해야 합니다.`),
    "추가 근거가 들어오면 SourceVet과 ACH를 다시 실행해 생존 가설을 재평가합니다."
  ]);
}

function buildAuthorityRefs(context: AnswerContext): string[] {
  const team = context.teamResult;
  return uniqueNonEmpty([
    team ? `teamRun=${team.run.id}` : undefined,
    team?.outputs.ach ? `achCase=${team.outputs.ach.caseId}` : undefined,
    team?.outputs.verification ? `verification=${team.outputs.verification.status}` : undefined,
    team ? `traceEvents=${team.trace.length}` : undefined,
    context.modelResponses.length > 0 ? `modelProposals=${context.modelResponses.length}` : undefined
  ]);
}

function buildWarnings(context: AnswerContext): string[] {
  const warnings = context.modelResponses.flatMap((response) => response.warnings);
  if (!context.teamResult?.outputs.sourceReview) {
    warnings.push("SourceVet은 현재 런타임 기본 경로에서 생략되었습니다. 외부/문서 근거가 붙으면 다시 켜야 합니다.");
  }
  if (!context.teamResult?.outputs.brief) {
    warnings.push("Briefing agent는 CLI 런타임에서 생략되었습니다. 사용자 답변은 RuntimeAnswer composer가 생성했습니다.");
  }
  return uniqueNonEmpty(warnings);
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
