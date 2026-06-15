# Regression Summary

## Current Command

```bash
npm test
```

## Expected Result

- `npm run build`: import check passed
- WARDEN regression: `12/12 passed`
- storage regression: passed
- Codex dry-run regression: passed
- P5 regression: passed

## Regression Coverage

| Area | Coverage |
|---|---|
| Happy path | normal supply-chain ACH workflow |
| ACH verifier | missing reliability fails |
| P1 control plane | external approval pending |
| Policy | WRITE without policy, external approval, policy change denial |
| SourceVet | independent corroboration and circular lineage |
| Security | no silent egress, secret redaction, authority override denial, raw tool call denial |
| Persistence | JSONL restart, bundle export/import, corrupted bundle detection |
| Codex | dry-run Codex CLI adapter path |
| P5 live boundary | opt-in guard, API key guard, MCP timeout/malformed fail-closed, document ingestion |

## Non-Goals

Regression does not prove production readiness. It proves that the local harness preserves its control assumptions.
