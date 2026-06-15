# Submission Install Guide

## Requirements

- Node.js `>=22.14.0`
- npm

## Install

```bash
npm install
```

## Build Check

```bash
npm run build
```

Expected:

```text
Import check passed.
```

## Runtime Server

CLI mode:

```bash
npm run cli
```

Optional linked command:

```bash
npm link
warden
```

HTTP server mode:

```bash
npm start
```

Expected:

```text
WARDEN Agent Runtime Server
URL       http://127.0.0.1:8787
Model     mock
```

Create a run from another terminal:

```bash
curl -sS -X POST http://127.0.0.1:8787/runs \
  -H 'content-type: application/json' \
  -d '{"objective":"Analyze defense supply-chain disruption","maxIterations":2}'
```

The run should execute the internal WARDEN team and then stop at `waiting_approval` for the external OSINT-style step.

## Demo Report

```bash
npm run demo:warden:report
```

Expected:

```text
WARDEN P3 Report Demo
Regression: 12/12 passed
Report written: /.../reports/<runId>/index.html
```

## Full Verification

```bash
npm test
```

Expected:

```text
Regression summary: 12/12 passed
Storage regression: passed
Codex dry-run regression: passed
P5 regression: passed
Runtime server regression: passed
WARDEN CLI regression: passed
```

## Submission Package

```bash
npm run submission:package
```

Output:

```text
submission/warden-p6-package
```
