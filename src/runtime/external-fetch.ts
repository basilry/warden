import { assertApproved, type ApprovalRequest } from "../agent/approval.ts";
import { hashPayload } from "../agent/ids.ts";
import type { Claim, KnowledgeUnit } from "../agent/types.ts";

export const EXTERNAL_OSINT_FETCH_TOOL = "external_osint_fetch";
export const EXTERNAL_FETCH_STUB_EXTRACTED_AT = "2026-06-15T00:00:00.000Z";

export type ApprovedExternalFetchInput = {
  query: string;
  approval: ApprovalRequest;
  runId?: string;
  limit?: number;
  extractedAt?: string;
  extraTags?: string[];
};

export type ApprovedExternalFetchToolInput = {
  query?: unknown;
  limit?: unknown;
};

export function fetchApprovedExternalOsint(input: ApprovedExternalFetchInput): KnowledgeUnit[] {
  validateApprovedExternalFetch(input);
  const query = normalizeQuery(input.query);
  const limit = normalizeLimit(input.limit);
  const extractedAt = input.extractedAt ?? EXTERNAL_FETCH_STUB_EXTRACTED_AT;
  const tags = [...deriveQueryTags(query), ...(input.extraTags ?? [])];
  return buildFixtureUnits({ query, extractedAt, approval: input.approval, runId: input.runId, tags }).slice(0, limit);
}

export function createApprovedExternalOsintFetchHandler(context: {
  approval: ApprovalRequest;
  runId?: string;
  extractedAt?: string;
}): (input: ApprovedExternalFetchToolInput) => KnowledgeUnit[] {
  return (input) =>
    fetchApprovedExternalOsint({
      query: normalizeToolInputQuery(input),
      limit: normalizeToolInputLimit(input),
      approval: context.approval,
      runId: context.runId,
      extractedAt: context.extractedAt
    });
}

export function validateApprovedExternalFetch(input: ApprovedExternalFetchInput): void {
  assertApproved(input.approval);
  if (input.approval.action.name !== EXTERNAL_OSINT_FETCH_TOOL) {
    throw new Error(`Approval ${input.approval.id} is for ${input.approval.action.name}, not ${EXTERNAL_OSINT_FETCH_TOOL}.`);
  }
  if (input.approval.decision.risk !== "EXTERNAL") {
    throw new Error(`Approval ${input.approval.id} is not an EXTERNAL approval.`);
  }
  if (input.runId && input.approval.runId !== input.runId) {
    throw new Error(`Approval ${input.approval.id} belongs to run ${input.approval.runId}, not ${input.runId}.`);
  }
  normalizeQuery(input.query);
}

function buildFixtureUnits(input: {
  query: string;
  extractedAt: string;
  approval: ApprovalRequest;
  runId?: string;
  tags: string[];
}): KnowledgeUnit[] {
  return [
    makeUnit({
      slug: "supply-chain-risk-frame",
      sourceUri: "fixture://warden/approved-osint/supply-chain-risk-frame",
      extractedAt: input.extractedAt,
      approval: input.approval,
      runId: input.runId,
      tags: input.tags,
      reliability: "approved-local-fixture:B",
      claims: [
        {
          text:
            "대한민국 및 동북아 공급망 리스크는 반도체 장비, 배터리 핵심 원료, 방산 전자부품처럼 전략물자 통제와 생산 네트워크가 겹치는 품목을 우선 분리해 봐야 한다.",
          confidence: 0.72
        },
        {
          text:
            "승인 후 fetch 결과는 live web 수집이 아니라 P9 resume 경로를 검증하기 위한 로컬 deterministic fixture이다.",
          confidence: 1
        }
      ]
    }),
    makeUnit({
      slug: "northeast-asia-watchpoints",
      sourceUri: "fixture://warden/approved-osint/northeast-asia-watchpoints",
      extractedAt: input.extractedAt,
      approval: input.approval,
      runId: input.runId,
      tags: input.tags,
      reliability: "approved-local-fixture:B-",
      claims: [
        {
          text:
            "동북아 공급망 분석은 중국 수출통제, 일본 소재 공급, 대만 반도체 생산, 해상 물류 병목을 별도 축으로 나누면 후속 근거 수집 우선순위를 정하기 쉽다.",
          confidence: 0.68
        },
        {
          text:
            "공급망 교란과 제재 우회 비축 가설은 같은 관측값을 다르게 설명할 수 있으므로 ACH 생존 가설로 함께 유지해야 한다.",
          confidence: 0.66
        }
      ]
    }),
    makeUnit({
      slug: "approval-boundary-note",
      sourceUri: "fixture://warden/approved-osint/approval-boundary-note",
      extractedAt: input.extractedAt,
      approval: input.approval,
      runId: input.runId,
      tags: input.tags,
      reliability: "approved-local-fixture:A",
      claims: [
        {
          text:
            "외부 네트워크는 여전히 비활성화되어 있으며, 실제 OSINT connector는 별도 allowlist와 human approval audit가 붙은 뒤 교체해야 한다.",
          confidence: 1
        }
      ]
    })
  ];
}

function makeUnit(input: {
  slug: string;
  sourceUri: string;
  extractedAt: string;
  approval: ApprovalRequest;
  runId?: string;
  tags: string[];
  reliability: string;
  claims: Array<{ text: string; confidence: number }>;
}): KnowledgeUnit {
  const contentHash = hashPayload({
    slug: input.slug,
    sourceUri: input.sourceUri,
    claims: input.claims,
    approvalId: input.approval.id,
    runId: input.runId
  });
  const claims: Claim[] = input.claims.map((claim, index) => ({
    id: `claim_${input.slug}_${index + 1}`,
    text: claim.text,
    confidence: claim.confidence,
    evidenceRefs: [input.sourceUri]
  }));
  return {
    id: `ku_${input.slug}_${contentHash.slice(0, 12)}`,
    sourceUri: input.sourceUri,
    sourceType: "fixture",
    extractedAt: input.extractedAt,
    claims,
    provenance: {
      capturedBy: "agent",
      originalLocation: `approval:${input.approval.id}`,
      contentHash,
      parserVersion: "warden-approved-external-fetch-stub/v1"
    },
    reliability: input.reliability,
    tags: uniqueTags(["approved-external-fetch", "external-osint-stub", EXTERNAL_OSINT_FETCH_TOOL, ...input.tags])
  };
}

function normalizeToolInputQuery(input: ApprovedExternalFetchToolInput): string {
  if (!input || typeof input !== "object") return "approved external osint fixture";
  if (typeof input.query === "string") return input.query;
  return "approved external osint fixture";
}

function normalizeToolInputLimit(input: ApprovedExternalFetchToolInput): number | undefined {
  if (!input || typeof input !== "object") return undefined;
  return typeof input.limit === "number" ? input.limit : undefined;
}

function normalizeQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("Approved external fetch requires a non-empty query.");
  }
  if (/^https?:\/\//i.test(normalized)) {
    throw new Error("Approved external fetch stub accepts search queries, not direct URLs.");
  }
  return normalized;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 3;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error("Approved external fetch limit must be an integer from 1 to 10.");
  }
  return limit;
}

function deriveQueryTags(query: string): string[] {
  const lower = query.toLowerCase();
  return uniqueTags([
    "supply-chain",
    ...(lower.includes("korea") || query.includes("대한민국") || query.includes("한국") ? ["korea"] : []),
    ...(lower.includes("northeast") || query.includes("동북아") ? ["northeast-asia"] : []),
    ...(lower.includes("defense") || query.includes("방산") ? ["defense"] : [])
  ]);
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
