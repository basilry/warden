# WARDEN Agent Harness P0

This package implements the narrow waist of WARDEN:

- structured agent roles and handoff contracts
- in-memory trace and audit recorder
- policy decisions before tool execution
- deterministic local ACH adapter
- independent verification before briefing
- audit brief rendering
- regression fixtures

P0 deliberately excludes live LLM adapters, live MCP clients, web UI, external ingestion, and SourceVet mandatory flow. Those are P0+/P1 concerns.
