# WARDEN Troubleshooting

## Unsupported Storage

`WARDEN_STORAGE=sqlite` currently fails by design. Use `memory` or `jsonl`.

## Empty Persistence Demo

If `npm run demo:warden:persistence` reports zero restored jobs, approvals, trace events, or artifacts, check that `WARDEN_STORAGE_DIR` points to a writable local directory.

## Bundle Integrity Failure

The bundle manifest records file size and SHA-256. Regenerate the bundle if any file was edited after export.

## Report Not Found

`npm run demo:warden:report` writes to `reports/<runId>/index.html`. The persistence demo stores report artifacts under `data/p4-demo/artifacts/<runId>/`.
