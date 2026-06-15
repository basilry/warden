# Evaluation Guide

## What To Look For

1. Does the workflow keep model output proposal-only?
2. Are external actions approval-gated?
3. Is the final ACH result deterministic and independently verified?
4. Are SourceVet flags visible?
5. Can a non-developer inspect the HTML report?
6. Can regression reproduce known failures?
7. Are live paths opt-in rather than default?

## Suggested Evaluation Sequence

```bash
npm run demo:warden:report
npm test
```

Then open:

```text
reports/<runId>/index.html
```

## Scoring Checklist

| Criterion | Evidence |
|---|---|
| Offline reproducibility | `npm test` passes without live env vars |
| Tool governance | policy decisions and approval pending records |
| Source discipline | SourceVet panel and SV regression |
| Auditability | trace timeline and report artifacts |
| Security posture | SEC regression and docs/security.md |
| Honest scope | no production deployment or certification claims |
