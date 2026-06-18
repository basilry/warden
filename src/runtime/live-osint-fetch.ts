import type { ApprovalRequest } from "../agent/approval.ts";
import { hashPayload } from "../agent/ids.ts";
import type { KnowledgeUnit } from "../agent/types.ts";
import type { OsintFetchLike } from "../connectors/osint/http-client.ts";
import { fetchOsintJson, OsintHttpClientError } from "../connectors/osint/http-client.ts";
import {
  assertSourceAllowed,
  loadOsintAllowlist,
  selectAllowlistedSourceUrls
} from "../connectors/osint/allowlist.ts";
import { runOsintDiscoveryPipeline } from "../connectors/osint/discovery.ts";
import { normalizeOsintResponseToKnowledgeUnits, redactOsintPayload } from "../connectors/osint/normalizer.ts";
import { createOsintProviderQualityTracker } from "../connectors/osint/provider-quality.ts";
import { loadOsintSearchSources } from "../connectors/osint/search-sources.ts";
import type { OsintSearchSourceRegistry } from "../connectors/osint/search-types.ts";
import type {
  OsintAllowlist,
  OsintBlockedReason,
  OsintConnectorConfig,
  OsintFetchResult,
  OsintStoredArtifact
} from "../connectors/osint/types.ts";
import { EXTERNAL_OSINT_FETCH_TOOL } from "./external-fetch.ts";

export type ApprovedLiveOsintFetchInput = {
  query: string;
  queries?: string[];
  approval?: ApprovalRequest;
  runId: string;
  config: OsintConnectorConfig;
  allowlist?: OsintAllowlist;
  searchSources?: OsintSearchSourceRegistry;
  allowedSources?: string[];
  sourceUrls?: string[];
  preferredDomains?: string[];
  fetchImpl?: OsintFetchLike;
  now?: string;
};

export async function runApprovedLiveOsintFetch(input: ApprovedLiveOsintFetchInput): Promise<OsintFetchResult> {
  const approvalBlock = validateApprovalGuard(input.approval, input.runId);
  if (approvalBlock) return blocked(approvalBlock.reason, approvalBlock.warning);
  if (!input.config.liveOptIn) {
    return blocked("live_opt_in_required", "Live OSINT is disabled. Set WARDEN_OSINT_LIVE_OPT_IN=true to opt in.");
  }

  if (shouldUseNaturalLanguageSearch(input)) {
    const searchResult = await runLiveSearch(input);
    return {
      status: searchResult.status,
      blockedReason: searchResult.blockedReason as OsintBlockedReason | undefined,
      units: searchResult.units,
      artifacts: searchResult.artifacts,
      sourceVetRequired: true,
      promoteToAch: false,
      providerWarnings: searchResult.providerWarnings,
      providerTelemetry: searchResult.providerTelemetry,
      warnings:
        searchResult.status === "succeeded"
          ? [
              ...searchResult.warnings,
              "Live OSINT search result is unvetted and must pass SourceVet before ACH promotion."
            ]
          : searchResult.warnings
    };
  }

  const allowlistResult = loadAllowlist(input);
  if (allowlistResult.status === "blocked") return allowlistResult;

  const sourceSelection = selectSources(input, allowlistResult.allowlist);
  if (sourceSelection.status === "blocked") return sourceSelection;

  const capturedAt = input.now ?? new Date().toISOString();
  const artifacts: OsintStoredArtifact[] = [];
  const units = [];
  const warnings = [
    "Live OSINT result is unvetted and must pass SourceVet before ACH promotion.",
    "P13 guard scaffold does not promote live evidence into ACH."
  ];

  for (const sourceUri of sourceSelection.urls) {
    const allowed = assertSourceAllowed(sourceUri, allowlistResult.allowlist, { sourceIds: input.allowedSources });
    try {
      const response = await fetchOsintJson(
        sourceUri,
        {
          timeoutMs: input.config.timeoutMs,
          userAgent: input.config.userAgent
        },
        { fetchImpl: input.fetchImpl, now: capturedAt }
      );
      artifacts.push(makeArtifact("raw", sourceUri, capturedAt, response.payload));
      artifacts.push(makeArtifact("redacted", sourceUri, capturedAt, redactOsintPayload(response.payload)));
      units.push(
        ...normalizeOsintResponseToKnowledgeUnits(
          response.payload,
          {
            sourceUri,
            sourceId: allowed.source.id,
            approvalId: input.approval!.id,
            runId: input.runId,
            capturedAt,
            tags: allowed.source.tags
          },
          { maxResults: input.config.maxResults }
        )
      );
    } catch (error) {
      return blocked(mapErrorToBlockedReason(error), (error as Error).message, artifacts);
    }
  }

  if (units.length === 0) {
    return blocked("malformed_response", "Live OSINT returned no normalizable knowledge units.", artifacts);
  }

  return {
    status: "succeeded",
    units: units.slice(0, input.config.maxResults),
    artifacts,
    sourceVetRequired: true,
    promoteToAch: false,
    warnings
  };
}

function shouldUseNaturalLanguageSearch(input: ApprovedLiveOsintFetchInput): boolean {
  return input.config.searchEnabled && !input.sourceUrls?.length && !input.allowedSources?.length;
}

async function runLiveSearch(input: ApprovedLiveOsintFetchInput) {
  const queries = buildLiveSearchQueries(input);
  const perQueryMaxResults = Math.max(2, Math.ceil(input.config.maxResults / Math.max(1, queries.length)));
  const providerQuality = createOsintProviderQualityTracker();
  const merged: OsintFetchResult = {
    status: "blocked",
    blockedReason: "no_results",
    units: [],
    artifacts: [],
    sourceVetRequired: true,
    promoteToAch: false,
    providerWarnings: [],
    providerTelemetry: [],
    warnings: []
  };

  try {
    const registry = input.searchSources ?? loadOsintSearchSources(input.config.searchSourcesPath);
    for (const query of queries) {
      const result = await runOsintDiscoveryPipeline(
        {
          query,
          runId: input.runId,
          approvalId: input.approval!.id,
          sourceIds: input.allowedSources,
          preferredDomains: input.preferredDomains,
          maxResults: perQueryMaxResults,
          maxSources: input.config.maxSourcesPerQuery,
          timeoutMs: input.config.timeoutMs,
          userAgent: input.config.userAgent
        },
        registry,
        { fetchImpl: input.fetchImpl, now: input.now, providerQuality }
      );
      merged.artifacts.push(...result.artifacts);
      merged.providerWarnings?.push(...(result.providerWarnings ?? []));
      merged.providerTelemetry?.push(...(result.providerTelemetry ?? []));
      merged.warnings.push(`OSINT 검색식: ${query}`);
      merged.warnings.push(...result.warnings);
      if (result.status === "succeeded") {
        merged.status = "succeeded";
        merged.blockedReason = undefined;
        merged.units = uniqueKnowledgeUnits([...merged.units, ...result.units]).slice(0, input.config.maxResults);
        if (merged.units.length >= input.config.maxResults) break;
      } else {
        merged.blockedReason = (result.blockedReason as OsintBlockedReason | undefined) ?? merged.blockedReason;
      }
    }

    if (merged.status === "succeeded" && merged.units.length > 0) {
      return {
        ...merged,
        units: merged.units.slice(0, input.config.maxResults),
        warnings: summarizeLiveSearchWarnings(merged.warnings, merged.providerWarnings),
        providerWarnings: merged.providerWarnings,
        providerTelemetry: merged.providerTelemetry
      };
    }

    return {
      ...merged,
      warnings:
        merged.warnings.length > 0
          ? summarizeLiveSearchWarnings(merged.warnings, merged.providerWarnings)
          : ["OSINT search returned no usable results."]
    };
  } catch (error) {
    return {
      status: "blocked" as const,
      blockedReason: "config_invalid",
      units: [],
      artifacts: [],
      providerWarnings: [],
      providerTelemetry: [],
      warnings: [`Live OSINT search could not run: ${(error as Error).message}`]
    };
  }
}

function buildLiveSearchQueries(input: ApprovedLiveOsintFetchInput): string[] {
  return uniqueNonEmpty([input.query, ...(input.queries ?? [])]).slice(0, input.config.maxQueries);
}

function summarizeLiveSearchWarnings(warnings: string[], providerWarnings: OsintFetchResult["providerWarnings"]): string[] {
  const queries = warnings.filter((warning) => warning.startsWith("OSINT 검색식:"));
  const nonProvider = warnings.filter(
    (warning) => !warning.startsWith("OSINT 검색식:") && !/^Provider\s+/.test(warning)
  );
  const providerSummary = summarizeProviderWarnings(providerWarnings ?? []);
  return uniqueNonEmpty([
    queries.length > 0 ? `OSINT 검색식 ${queries.length}개 실행: ${queries.map((item) => item.replace(/^OSINT 검색식:\s*/, "")).join(" | ")}` : undefined,
    providerSummary,
    ...nonProvider
  ]).slice(0, 8);
}

function summarizeProviderWarnings(providerWarnings: NonNullable<OsintFetchResult["providerWarnings"]>): string | undefined {
  if (providerWarnings.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const warning of providerWarnings) {
    counts.set(warning.kind, (counts.get(warning.kind) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([kind, count]) => `${kind} ${count}건`).join(", ");
  return `OSINT 제공자 경고: ${summary}. 429/timeout은 provider backoff와 source budget을 적용해 일부 소스를 건너뛰었습니다.`;
}

function uniqueKnowledgeUnits(units: KnowledgeUnit[]): KnowledgeUnit[] {
  const seen = new Set<string>();
  const result: KnowledgeUnit[] = [];
  for (const unit of units) {
    const key = unit.sourceUri.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(unit);
  }
  return result;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function validateApprovalGuard(
  approval: ApprovalRequest | undefined,
  runId: string
): { reason: OsintBlockedReason; warning: string } | undefined {
  if (!approval) {
    return { reason: "approval_required", warning: "Live OSINT requires a resolved human approval." };
  }
  if (approval.status !== "approved") {
    return { reason: "approval_required", warning: `Approval ${approval.id} is ${approval.status}.` };
  }
  if (approval.runId !== runId) {
    return { reason: "approval_required", warning: `Approval ${approval.id} belongs to run ${approval.runId}.` };
  }
  if (approval.action.name !== EXTERNAL_OSINT_FETCH_TOOL || approval.decision.risk !== "EXTERNAL") {
    return {
      reason: "approval_required",
      warning: `Approval ${approval.id} is not valid for ${EXTERNAL_OSINT_FETCH_TOOL}.`
    };
  }
  return undefined;
}

function loadAllowlist(
  input: ApprovedLiveOsintFetchInput
): { status: "ready"; allowlist: OsintAllowlist } | OsintFetchResult {
  try {
    return { status: "ready", allowlist: input.allowlist ?? loadOsintAllowlist(input.config.allowlistPath) };
  } catch (error) {
    return blocked("allowlist_missing", `OSINT allowlist could not be loaded: ${(error as Error).message}`);
  }
}

function selectSources(
  input: ApprovedLiveOsintFetchInput,
  allowlist: OsintAllowlist
): { status: "ready"; urls: string[] } | OsintFetchResult {
  try {
    const urls = selectAllowlistedSourceUrls(allowlist, {
      sourceIds: input.allowedSources,
      sourceUrls: input.sourceUrls
    });
    if (urls.length === 0) {
      return blocked("source_not_allowed", "No enabled OSINT allowlist source matched the request.");
    }
    return { status: "ready", urls };
  } catch (error) {
    return blocked("source_not_allowed", (error as Error).message);
  }
}

function blocked(
  blockedReason: OsintBlockedReason,
  warning: string,
  artifacts: OsintStoredArtifact[] = []
): OsintFetchResult {
  return {
    status: "blocked",
    blockedReason,
    units: [],
    artifacts,
    sourceVetRequired: true,
    promoteToAch: false,
    warnings: [warning]
  };
}

function mapErrorToBlockedReason(error: unknown): OsintBlockedReason {
  if (error instanceof OsintHttpClientError) return error.code;
  if ((error as Error).name === "MalformedOsintPayloadError") return "malformed_response";
  return "http_error";
}

function makeArtifact(type: "raw" | "redacted", sourceUri: string, capturedAt: string, payload: unknown): OsintStoredArtifact {
  const contentHash = hashPayload({ type, sourceUri, capturedAt, payload });
  return {
    id: `artifact_live_osint_${type}_${contentHash.slice(0, 12)}`,
    type,
    sourceUri,
    capturedAt,
    contentHash,
    payload
  };
}
