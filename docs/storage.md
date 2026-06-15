# WARDEN Storage

P4 introduces a storage provider boundary so the harness can keep durable state outside a single process.

## Providers

- `memory`: default, process-local, useful for deterministic demos and tests.
- `jsonl`: durable local files under `WARDEN_STORAGE_DIR`.
- `sqlite`: reserved in the provider contract, intentionally not implemented yet.

## JSONL Layout

```text
data/
  jobs.jsonl
  approvals.jsonl
  knowledge.jsonl
  artifacts.jsonl
  traces/<runId>.jsonl
  artifacts/<runId>/index.html
  artifacts/<runId>/report.json
  bundles/<runId>/manifest.json
```

Jobs, approvals, and knowledge are append-only JSONL streams. Readers deduplicate by record id and keep the latest record. Trace events remain append-only per run.

## Regression

```bash
npm run demo:warden:storage-regression
```

This creates an isolated JSONL store under the system temp directory, verifies restart-style reads, exports a bundle, imports it into memory, and checks that a corrupted bundle is rejected by integrity verification.

## Configuration

```bash
WARDEN_STORAGE=jsonl
WARDEN_STORAGE_DIR=data/p4-demo
```

Without these variables the harness keeps the previous in-memory behavior.
