import { newId, nowIso } from "./ids.ts";
import type { AgentRole, PolicyDecision, ToolAction } from "./types.ts";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type ApprovalRequest = {
  id: string;
  runId: string;
  action: ToolAction;
  decision: PolicyDecision;
  requestedBy: AgentRole;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  reason?: string;
};

export type ApprovalQueue = {
  submit(args: {
    runId: string;
    action: ToolAction;
    decision: PolicyDecision;
    requestedBy: AgentRole;
    reason?: string;
  }): ApprovalRequest;
  approve(id: string, approver: string, reason: string): ApprovalRequest;
  deny(id: string, approver: string, reason: string): ApprovalRequest;
  listPending(runId?: string): ApprovalRequest[];
  get(id: string): ApprovalRequest | undefined;
  listAll(): ApprovalRequest[];
};

export function createApprovalQueue(): ApprovalQueue {
  const requests: ApprovalRequest[] = [];

  return {
    submit(args) {
      const request: ApprovalRequest = {
        id: newId("approval"),
        runId: args.runId,
        action: args.action,
        decision: args.decision,
        requestedBy: args.requestedBy,
        status: "pending",
        createdAt: nowIso(),
        reason: args.reason
      };
      requests.push(request);
      return request;
    },
    approve(id, approver, reason) {
      return resolve(id, "approved", approver, reason);
    },
    deny(id, approver, reason) {
      return resolve(id, "denied", approver, reason);
    },
    listPending(runId) {
      return requests.filter((request) => request.status === "pending" && (!runId || request.runId === runId));
    },
    get(id) {
      return requests.find((request) => request.id === id);
    },
    listAll() {
      return [...requests];
    }
  };

  function resolve(id: string, status: ApprovalStatus, approver: string, reason: string): ApprovalRequest {
    const request = requests.find((item) => item.id === id);
    if (!request) {
      throw new Error(`Approval request not found: ${id}`);
    }
    if (request.status !== "pending") {
      throw new Error(`Approval request is not pending: ${id}`);
    }
    request.status = status;
    request.resolvedAt = nowIso();
    request.resolvedBy = approver;
    request.reason = reason;
    return request;
  }
}

export function assertApproved(request: ApprovalRequest): void {
  if (request.status !== "approved") {
    throw new Error(`Approval request ${request.id} is ${request.status}; action may not execute.`);
  }
}

export function renderApprovalQueue(queue: ApprovalQueue): string {
  const pending = queue.listPending();
  if (pending.length === 0) {
    return "No pending approvals.";
  }
  return pending
    .map(
      (request) =>
        `- ${request.id}: ${request.action.name} (${request.decision.risk}) requestedBy=${request.requestedBy} status=${request.status}`
    )
    .join("\n");
}
