# WARDEN Local Install

Requirements:

- Node.js `>=22.14.0`
- npm

Install and verify:

```bash
npm install
npm test
```

Run the terminal CLI:

```bash
npm run cli
```

Optional local command link:

```bash
npm link
warden
```

Start the runtime server:

```bash
npm start
```

Create a runtime run from another terminal:

```bash
curl -sS -X POST http://127.0.0.1:8787/runs \
  -H 'content-type: application/json' \
  -d '{"objective":"방산 공급망 핵심 부품 수입 급감 원인을 분석해줘","maxIterations":2}'
```

Run the local demos:

```bash
npm run demo:warden:cli
npm run demo:warden:runtime
npm run demo:warden
npm run demo:warden:sourcevet
npm run demo:warden:report
npm run demo:warden:persistence
```

The persistence demo uses `WARDEN_STORAGE=jsonl` and writes durable local state under `data/p4-demo` unless overridden.
