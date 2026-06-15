import { loadWardenConfig } from "../src/agent/config.ts";
import { createApprovalQueue } from "../src/agent/approval.ts";
import { runApprovedLiveOsintFetch } from "../src/runtime/live-osint-fetch.ts";
import type { OsintFetchLike } from "../src/connectors/osint/http-client.ts";
import type { OsintAllowlist } from "../src/connectors/osint/types.ts";

const runId = "runtime_p13_live_osint_guard";
const approvalQueue = createApprovalQueue();
const pending = approvalQueue.submit({
  runId,
  action: {
    name: "external_osint_fetch",
    capability: "RFI Watch",
    server: "external",
    risk: "EXTERNAL",
    input: { query: "대한민국 및 동북아 공급망" }
  },
  decision: {
    decision: "require_approval",
    risk: "EXTERNAL",
    reason: "External calls require human approval."
  },
  requestedBy: "supervisor"
});
const approved = approvalQueue.approve(pending.id, "operator", "P13 regression approval.");
const config = loadWardenConfig({
  WARDEN_MODEL_PROVIDER: "mock",
  WARDEN_OSINT_LIVE_OPT_IN: "true",
  WARDEN_OSINT_SEARCH_ENABLED: "false",
  WARDEN_OSINT_TIMEOUT_MS: "20",
  WARDEN_OSINT_MAX_RESULTS: "2"
}).osint;

const allowlist: OsintAllowlist = {
  version: "v1",
  sources: [
    {
      id: "sample",
      name: "Sample OSINT",
      url: "https://osint.example.test/warden/supply-chain/sample.json",
      enabled: true,
      allowedDomains: ["osint.example.test"],
      allowedPaths: ["/warden/supply-chain/"],
      method: "GET",
      contentType: "json",
      tags: ["sample"]
    }
  ]
};

let fetchCalls = 0;
const deterministicFetch: OsintFetchLike = async () => {
  fetchCalls += 1;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      documents: [
        {
          title: "Korea supply-chain sample",
          url: "https://osint.example.test/warden/supply-chain/report-a",
          publishedAt: "2026-06-15T00:00:00.000Z",
          claims: [
            {
              text: "동북아 공급망 리스크는 반도체 장비와 배터리 핵심 원료를 별도 watchpoint로 분리해야 한다.",
              confidence: 0.7
            }
          ],
          tags: ["korea", "northeast-asia"]
        }
      ]
    })
  };
};

const noApproval = await runApprovedLiveOsintFetch({
  query: "대한민국 공급망",
  runId,
  config,
  allowlist,
  fetchImpl: deterministicFetch
});
assertEqual(noApproval.status, "blocked", "no approval status");
assertEqual(noApproval.blockedReason, "approval_required", "no approval reason");
assertEqual(fetchCalls, 0, "no approval fetch calls");

const noOptIn = await runApprovedLiveOsintFetch({
  query: "대한민국 공급망",
  runId,
  approval: approved,
  config: { ...config, liveOptIn: false },
  allowlist,
  fetchImpl: deterministicFetch
});
assertEqual(noOptIn.status, "blocked", "no opt-in status");
assertEqual(noOptIn.blockedReason, "live_opt_in_required", "no opt-in reason");
assertEqual(fetchCalls, 0, "no opt-in fetch calls");

const notAllowed = await runApprovedLiveOsintFetch({
  query: "대한민국 공급망",
  runId,
  approval: approved,
  config,
  allowlist,
  sourceUrls: ["https://untrusted.example.test/anything.json"],
  fetchImpl: deterministicFetch
});
assertEqual(notAllowed.status, "blocked", "not allowlisted status");
assertEqual(notAllowed.blockedReason, "source_not_allowed", "not allowlisted reason");
assertEqual(fetchCalls, 0, "not allowlisted fetch calls");

const timeout = await runApprovedLiveOsintFetch({
  query: "대한민국 공급망",
  runId,
  approval: approved,
  config: { ...config, timeoutMs: 1 },
  allowlist,
  fetchImpl: () => new Promise(() => undefined)
});
assertEqual(timeout.status, "blocked", "timeout status");
assertEqual(timeout.blockedReason, "timeout", "timeout reason");

const malformed = await runApprovedLiveOsintFetch({
  query: "대한민국 공급망",
  runId,
  approval: approved,
  config,
  allowlist,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ unexpected: true })
  })
});
assertEqual(malformed.status, "blocked", "malformed status");
assertEqual(malformed.blockedReason, "malformed_response", "malformed reason");

const succeeded = await runApprovedLiveOsintFetch({
  query: "대한민국 공급망",
  runId,
  approval: approved,
  config,
  allowlist,
  fetchImpl: deterministicFetch,
  now: "2026-06-15T00:00:00.000Z"
});
assertEqual(succeeded.status, "succeeded", "success status");
assertEqual(succeeded.sourceVetRequired, true, "sourcevet required");
assertEqual(succeeded.promoteToAch, false, "ach promotion guard");
assertEqual(succeeded.units.length, 1, "unit count");
assertIncludes(succeeded.units[0].tags.join(","), "sourcevet-required", "sourcevet tag");
assertEqual(succeeded.artifacts.length, 2, "raw and redacted artifacts");

console.log("WARDEN live OSINT guard regression: passed");

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}
