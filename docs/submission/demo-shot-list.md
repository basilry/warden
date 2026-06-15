# Demo Shot List

## Shot 1: Terminal Setup

- Show repository path.
- Run `npm install` only if dependencies are missing.
- Run `npm run build`.

## Shot 2: Team Run

Command:

```bash
npm run demo:warden
```

Capture:

- run id
- survivor hypotheses
- verification pass

## Shot 3: SourceVet

Command:

```bash
npm run demo:warden:sourcevet
```

Capture:

- SourceVet status
- flags and recommendations

## Shot 4: P1 Control Plane

Command:

```bash
npm run demo:warden:p1
```

Capture:

- job history
- approval pending
- tool catalog

## Shot 5: HTML Report

Command:

```bash
npm run demo:warden:report
```

Open:

```text
reports/<runId>/index.html
```

Capture:

- header status
- approval panel
- policy panel
- SourceVet panel
- trace timeline

## Shot 6: Regression

Command:

```bash
npm test
```

Capture:

- `Regression summary: 12/12 passed`
- storage regression
- Codex dry-run regression
- P5 regression

## File Naming

```text
warden-demo-YYYYMMDD-v1.mp4
warden-report-<runId>.html
warden-submission-package-YYYYMMDD.zip
```
