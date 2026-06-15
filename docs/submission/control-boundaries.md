# Control Boundaries

## Authority Boundary

LLM output has no direct authority. It can propose plans and text, but deterministic modules own authority-bearing records.

Authority-bearing modules:

- ACH Analyst
- SourceVet Reviewer
- Policy Reviewer
- Verifier
- Approval Queue

## Tool Boundary

Tools are invoked through planned calls and policy checks. External tools require approval and are not executed silently.

## Storage Boundary

P4 provides memory and JSONL storage providers. JSONL storage is local durable storage for PoC use, not a multi-tenant production database.

## Live Boundary

Live Codex/OpenAI/MCP integrations are explicit opt-in. Default `npm test` remains offline and deterministic.

## Audit Boundary

Trace events, report artifacts, and regression fixtures make failures reproducible. P5 includes a candidate audit hash chain, but external notarization is not implemented.
