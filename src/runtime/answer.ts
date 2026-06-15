import type { ApprovalRequest } from "../agent/approval.ts";
import {
  createModelRequest,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse
} from "../agent/model-adapter.ts";
import type { TeamRunResult, VerificationReport } from "../agent/types.ts";
import type { RuntimeRunStatus } from "./types.ts";

export type RuntimeAnswerMode = "deterministic" | "assisted";

export type RuntimeAnswer = {
  mode: RuntimeAnswerMode;
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

export type RuntimeAnswerDraft = {
  title?: string;
  directAnswer?: string;
  nextSteps?: string[];
};

export type AnswerValidationReport = {
  status: "pass" | "warn";
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
    mode: "deterministic",
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

export async function composeModelAssistedAnswer(
  context: AnswerContext,
  model: ModelAdapter
): Promise<{ answer: RuntimeAnswer; response?: ModelResponse<unknown> }> {
  const request = createAnswerDraftRequest(context);
  const response = await model.generate<unknown>(request);
  return {
    answer: composeModelAssistedAnswerFromResponse(context, response),
    response
  };
}

export function createAnswerDraftRequest(context: AnswerContext): ModelRequest {
  const deterministic = composeDeterministicAnswer(context);
  return createModelRequest({
    role: "briefing",
    responseFormat: "json",
    prompt: [
      "You are drafting a Korean user-facing answer for WARDEN.",
      "You may improve wording only. Do not change ACH survivors, policy status, approvals, evidence, or uncertainty.",
      "Return only JSON with optional fields: title, directAnswer, nextSteps.",
      "Do not claim external OSINT was used if approval is pending.",
      "",
      `Objective: ${context.objective}`,
      `Deterministic direct answer: ${deterministic.directAnswer}`,
      `Key findings: ${deterministic.keyFindings.join(" | ")}`,
      `Uncertainty: ${deterministic.uncertainty.join(" | ")}`,
      `Blocked actions: ${deterministic.blockedActions.join(" | ") || "none"}`
    ].join("\n"),
    context: buildAnswerDraftContext(context, deterministic)
  });
}

export function composeModelAssistedAnswerFromResponse(
  context: AnswerContext,
  response: ModelResponse<unknown>
): RuntimeAnswer {
  const deterministic = composeDeterministicAnswer(context);
  const draft = parseAnswerDraft(response.output);

  if (!draft) {
    return {
      ...deterministic,
      warnings: uniqueNonEmpty([
        ...deterministic.warnings,
        ...response.warnings,
        "모델 보조 답변 초안이 유효한 RuntimeAnswerDraft가 아니라 deterministic answer로 fallback했습니다."
      ])
    };
  }

  const candidate: RuntimeAnswer = {
    ...deterministic,
    mode: "assisted",
    title: draft.title?.trim() || deterministic.title,
    directAnswer: draft.directAnswer?.trim() || deterministic.directAnswer,
    nextSteps: uniqueNonEmpty([...(draft.nextSteps ?? []), ...deterministic.nextSteps]),
    warnings: uniqueNonEmpty([...deterministic.warnings, ...response.warnings])
  };
  const validation = validateAnswerAgainstAuthorities(candidate, context);

  if (validation.status === "warn") {
    return {
      ...candidate,
      directAnswer: validation.warnings.some((warning) => warning.includes("directAnswer"))
        ? deterministic.directAnswer
        : candidate.directAnswer,
      warnings: uniqueNonEmpty([...candidate.warnings, ...validation.warnings])
    };
  }

  return {
    ...candidate,
    warnings: uniqueNonEmpty([...candidate.warnings, ...validation.warnings])
  };
}

export function validateAnswerAgainstAuthorities(answer: RuntimeAnswer, context: AnswerContext): AnswerValidationReport {
  const warnings: string[] = [];
  const survivors = context.teamResult?.outputs.ach?.survivors ?? [];
  const pendingApprovals = context.approvals.filter((approval) => approval.status === "pending");
  const answerText = [
    answer.directAnswer,
    ...answer.keyFindings,
    ...answer.uncertainty,
    ...answer.blockedActions,
    ...answer.nextSteps
  ].join("\n");

  for (const survivor of survivors) {
    if (!answer.keyFindings.some((finding) => finding.includes(survivor))) {
      warnings.push(`authority violation: survivor "${survivor}" missing from keyFindings.`);
    }
  }

  for (const approval of pendingApprovals) {
    if (!answer.blockedActions.some((blocked) => blocked.includes(approval.action.name))) {
      warnings.push(`authority violation: pending approval "${approval.action.name}" missing from blockedActions.`);
    }
  }

  if (
    pendingApprovals.length > 0 &&
    /외부.*(반영했습니다|반영됨|반영했다|수집 완료|확인 완료)|승인 완료/.test(answer.directAnswer)
  ) {
    warnings.push("authority violation: directAnswer implies external evidence or approval completion before approval.");
  }

  if (/확정 결론|단정할 수 있습니다|단정한다/.test(answer.directAnswer)) {
    warnings.push("authority violation: directAnswer overstates certainty.");
  }

  if (context.teamResult?.outputs.sourceReview?.flags.length) {
    for (const flag of context.teamResult.outputs.sourceReview.flags) {
      if (!answerText.includes(flag.code) && !answerText.includes(flag.summary)) {
        warnings.push(`authority warning: SourceVet flag "${flag.code}" is not visible in the answer.`);
      }
    }
  }

  const verification = context.teamResult?.outputs.verification;
  for (const risk of verificationResidualRisk(verification)) {
    if (!answer.uncertainty.some((item) => item.includes(risk))) {
      warnings.push(`authority warning: residual risk missing from uncertainty: ${risk}`);
    }
  }

  return {
    status: warnings.length > 0 ? "warn" : "pass",
    warnings
  };
}

function buildAnswerDraftContext(context: AnswerContext, deterministic: RuntimeAnswer): unknown {
  return {
    objective: context.objective,
    runStatus: context.runStatus,
    deterministicAnswer: {
      directAnswer: deterministic.directAnswer,
      keyFindings: deterministic.keyFindings,
      uncertainty: deterministic.uncertainty,
      blockedActions: deterministic.blockedActions,
      nextSteps: deterministic.nextSteps,
      authorityRefs: deterministic.authorityRefs
    }
  };
}

function parseAnswerDraft(output: unknown): RuntimeAnswerDraft | undefined {
  const parsed = typeof output === "string" ? parseJsonObject(output) : output;
  if (!isRecord(parsed)) return undefined;
  const directAnswer = typeof parsed.directAnswer === "string" ? parsed.directAnswer : undefined;
  const title = typeof parsed.title === "string" ? parsed.title : undefined;
  const nextSteps = Array.isArray(parsed.nextSteps)
    ? parsed.nextSteps.filter((item): item is string => typeof item === "string")
    : undefined;
  if (!directAnswer && !title && !nextSteps?.length) return undefined;
  return { title, directAnswer, nextSteps };
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function verificationResidualRisk(verification: VerificationReport | undefined): string[] {
  return verification?.residualRisk ?? [];
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
