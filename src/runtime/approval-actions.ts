import type { ApprovalRequest, ApprovalStatus } from "../agent/approval.ts";
import { nowIso } from "../agent/ids.ts";
import type { RuntimeEvent, RuntimeRun } from "./types.ts";

export type PendingApprovalSelector = {
  approvalId?: string;
  toolName?: string;
};

export type ApprovalActionInput = PendingApprovalSelector & {
  actor: string;
  reason?: string;
  now?: string;
};

export type RuntimeApprovalActionResult = {
  run: RuntimeRun;
  approval: ApprovalRequest;
  remainingPending: ApprovalRequest[];
  resumeReady: boolean;
};

export function approvePendingApproval(run: RuntimeRun, input: ApprovalActionInput): RuntimeApprovalActionResult {
  return resolvePendingApproval(run, { ...input, status: "approved" });
}

export function rejectPendingApproval(run: RuntimeRun, input: ApprovalActionInput): RuntimeApprovalActionResult {
  return resolvePendingApproval(run, { ...input, status: "denied" });
}

export function resolvePendingApproval(
  run: RuntimeRun,
  input: ApprovalActionInput & { status: Extract<ApprovalStatus, "approved" | "denied"> }
): RuntimeApprovalActionResult {
  const actor = input.actor.trim();
  if (!actor) {
    throw new Error("Approval action requires a non-empty actor.");
  }

  const resolvedAt = input.now ?? nowIso();
  const target = selectPendingApproval(run.approvals, input);
  if (target.runId !== run.id) {
    throw new Error(`Approval ${target.id} belongs to run ${target.runId}, not ${run.id}.`);
  }

  const resolved: ApprovalRequest = {
    ...target,
    status: input.status,
    resolvedAt,
    resolvedBy: actor,
    reason: input.reason?.trim() || defaultResolutionReason(input.status)
  };
  const approvals = run.approvals.map((approval) => (approval.id === target.id ? resolved : approval));
  const remainingPending = approvals.filter((approval) => approval.status === "pending");
  const resumeReady = input.status === "approved" && remainingPending.length === 0;
  const events = [
    ...run.events,
    makeEvent(run.id, "approval.resolved", renderApprovalResolutionMessage(resolved), resolvedAt, {
      approvalId: resolved.id,
      status: resolved.status,
      toolName: resolved.action.name,
      resolvedBy: resolved.resolvedBy
    }),
    ...(resumeReady
      ? [
          makeEvent(run.id, "run.resume_ready", "모든 승인 대기가 해소되어 런타임을 재개할 수 있습니다.", resolvedAt, {
            approvalId: resolved.id,
            toolName: resolved.action.name
          })
        ]
      : [])
  ];

  return {
    run: {
      ...run,
      status: nextRunStatus(run, input.status, resumeReady),
      approvals,
      events,
      updatedAt: resolvedAt,
      completedAt: input.status === "denied" ? resolvedAt : run.completedAt,
      error: input.status === "denied" ? `Approval denied for ${resolved.action.name}: ${resolved.reason}` : run.error
    },
    approval: resolved,
    remainingPending,
    resumeReady
  };
}

export function selectPendingApproval(
  approvals: ApprovalRequest[],
  selector: PendingApprovalSelector
): ApprovalRequest {
  const matches = approvals.filter((approval) => {
    if (approval.status !== "pending") return false;
    if (selector.approvalId) return approval.id === selector.approvalId;
    if (selector.toolName) return approval.action.name === selector.toolName;
    return true;
  });

  if (matches.length === 0) {
    const scope = selector.approvalId ?? selector.toolName ?? "run";
    throw new Error(`No pending approval matched ${scope}.`);
  }
  if (matches.length > 1) {
    throw new Error("Approval selector matched multiple pending approvals; pass approvalId.");
  }
  return matches[0];
}

export function hasPendingApprovals(run: RuntimeRun): boolean {
  return run.approvals.some((approval) => approval.status === "pending");
}

function nextRunStatus(
  run: RuntimeRun,
  status: Extract<ApprovalStatus, "approved" | "denied">,
  resumeReady: boolean
): RuntimeRun["status"] {
  if (status === "denied") return "failed";
  if (resumeReady && run.status === "waiting_approval") return "running";
  return run.status;
}

function defaultResolutionReason(status: Extract<ApprovalStatus, "approved" | "denied">): string {
  return status === "approved" ? "운영자가 승인했습니다." : "운영자가 거부했습니다.";
}

function renderApprovalResolutionMessage(approval: ApprovalRequest): string {
  const label = approval.status === "approved" ? "승인됨" : "거부됨";
  return `${approval.action.name} 승인 요청이 ${label} 상태가 되었습니다.`;
}

function makeEvent(
  runId: string,
  type: RuntimeEvent["type"],
  message: string,
  ts: string,
  data?: unknown
): RuntimeEvent {
  return {
    ts,
    runId,
    type,
    message,
    data
  };
}
