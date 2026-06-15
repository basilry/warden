# Security And OPSEC

## Default Position

WARDEN is offline-first. Default demos and regression do not require live external network calls.

## Key Controls

- Model output is proposal-only.
- Raw model tool execution is denied.
- ACH survivors and ranking cannot be overwritten by model text.
- External calls require approval.
- Secret-like payloads are redacted.
- stdio MCP commands and tools are allowlisted.
- Timeout and malformed MCP responses fail closed.

## What WARDEN Does Not Claim

- It does not claim production military network deployment.
- It does not claim security certification.
- It does not claim autonomous internet collection.
- It does not claim customer operational references.

## Live Mode

Live model and Codex paths are opt-in.

```bash
WARDEN_CODEX_DRY_RUN=0 npm run demo:warden:codex
```

OpenAI-compatible live calls require:

- `WARDEN_OPENAI_DRY_RUN=0`
- `WARDEN_OPENAI_LIVE_OPT_IN=true`
- API key env configured at runtime

## OPSEC Notes

Representative PoC data should be sanitized before ingestion. Production use would require partner-specific review for identity, storage, network routing, document classification, retention, and audit export.
