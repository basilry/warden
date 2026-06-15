# WARDEN One-Pager

## Summary

WARDEN is an offline-first multi-agent harness for defense analysis workflows. It lets teams use LLMs without trusting them directly by placing every agent action behind policy checks, human approval, deterministic analysis, independent verification, and audit logs.

## Problem

For defense workflows, the problem is not only answer quality. Teams need traceability, external-call control, source reliability review, reproducibility, and clear separation between model suggestions and approved system authority.

## Solution

WARDEN treats model output as proposal-only. Deterministic modules such as ACH, SourceVet, Policy Reviewer, and Verifier produce the authority-bearing records.

## Key Capabilities

- Supervisor-led specialist agent team
- ACH hypothesis analysis
- SourceVet source reliability review
- Policy Reviewer for planned tool calls
- Human approval queue for external actions
- JSONL persistence and run bundle export/import
- Static HTML audit report
- Security regression pack
- Codex CLI/OAuth path with dry-run default and explicit live opt-in

## Demo

```bash
npm install
npm run demo:warden:report
npm test
```

The audit report is written to:

```text
reports/<runId>/index.html
```

## Current Maturity

WARDEN is a local MVP and submission-ready technical demo. It does not claim production deployment, military network accreditation, or operational customer references.

## Partner PoC Ask

A partner PoC should provide representative documents, approval policies, and RFI patterns so WARDEN can adapt its KnowledgeUnit extraction, SourceVet rules, ACH matrix, and approval policy to the partner environment.
