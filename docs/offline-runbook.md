# WARDEN Offline Runbook

The current runtime is offline-first by default: no live LLM, no live MCP server, and no external network call is required for the deterministic path.

1. Install dependencies with `npm install`.
2. Run `npm test` to verify import and regression coverage.
3. Run `npm start` to start the local WARDEN runtime server at `http://127.0.0.1:8787`.
4. Create a run with `POST /runs`; the first loop executes the internal WARDEN team and the external OSINT step remains approval-gated.
5. Run `npm run demo:warden:report` if a static audit report is needed under `reports/<runId>/index.html`.
6. Run `npm run demo:warden:persistence` to create JSONL state and an export bundle under `data/p4-demo/bundles/<runId>`.

For an air-gapped handoff, copy the generated bundle directory. The manifest contains SHA-256 hashes for every file and can be checked with the bundle verifier used by the persistence demo.
