# Demo Checklist

## Before Recording

- [ ] Terminal width at least 120 columns
- [ ] Browser zoom 90-100 percent
- [ ] `npm run build` passes
- [ ] `npm run cli` opens WARDEN CLI
- [ ] `warden run "<objective>"` works after `npm link` if global command is being demonstrated
- [ ] `npm start` shows the WARDEN runtime server banner
- [ ] `POST /runs` creates a runtime run
- [ ] `GET /runs/<runId>` shows `run_warden_team` succeeded and external action waiting for approval
- [ ] `npm run demo:warden:report` creates a report
- [ ] `npm test` passes
- [ ] No secrets are visible in terminal
- [ ] No live mode env vars are enabled unless explicitly demonstrated

## Commands

```bash
npm run cli
npm run demo:warden:cli
npm start
npm run demo:warden:runtime
npm run demo:warden
npm run demo:warden:p1
npm run demo:warden:sourcevet
npm run demo:warden:report
npm test
```

## Dry Run Count

Run the full command sequence three times before final recording if time allows.
