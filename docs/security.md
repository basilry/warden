# WARDEN P5 Security Notes

P5 adds live-capable boundaries without making live behavior the default.

## Model Authority

Model output is proposal-only. It can suggest plans or summaries, but it cannot directly execute tools or replace deterministic authority values such as ACH survivors, SourceVet risk, or policy decisions.

Implemented guardrails:

- `validateModelOutputAgainstAuthority`
- `rejectToolExecutionFromRawModelOutput`
- `WARDEN_OPENAI_LIVE_OPT_IN`
- `WARDEN_CODEX_DRY_RUN`

## Secret Redaction

Trace-like payloads and dry-run model payloads should be redacted before persistence or display.

Implemented guardrails:

- `redactPayload`
- `redactText`
- `assertNoSecretInPayload`

The default policy redacts common API key, bearer token, access token, password, secret, authorization, and cookie fields.

## Egress

External actions are treated as approval-required. A model can propose an external call, but that proposal must be converted into a reviewed `ToolCallPlan` before anything invokes it.

Implemented guardrails:

- `evaluateEgressPolicy`
- `assertNoEgressWithoutApproval`
- SEC regression fixtures under `fixtures/regression/SEC-*`

## MCP

stdio MCP invocation is allowlist-gated. The current implementation supports local one-shot JSON-RPC fixture calls and fails closed on timeout or malformed responses.

Controls:

- `commandAllowlist`
- `allowTools`
- `timeoutMs`
- malformed response validation

Remote or production MCP servers still need stronger schema validation and approval queue integration before operational use.

## Audit Integrity

`buildAuditHashChain` and `verifyAuditHashChain` provide a candidate hash-chain mechanism for detecting trace tampering. This is not a substitute for append-only storage or external notarization.
