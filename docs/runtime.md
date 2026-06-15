# WARDEN Runtime Server

WARDEN runtime server is the main executable path for this project. It starts an HTTP server, creates agent runs, asks a configured model adapter for planner proposals, and routes actual tool execution through policy, MCP boundaries, approvals, and deterministic WARDEN workflow code.

The default path is offline-first. It does not call a live LLM or live MCP server unless explicitly configured.

## CLI

For a Codex/Claude-style terminal entrypoint, use:

```bash
npm run cli
```

After linking the package locally:

```bash
npm link
warden
```

Common commands:

```bash
warden
warden run "Analyze defense supply-chain disruption"
warden server
```

`warden` opens interactive chat mode. Each entered objective creates a local runtime run in the same process. `warden server` starts the HTTP runtime server described below.

Interactive approval commands:

```text
/approve [approvalId|toolName]
/reject [approvalId|toolName]
```

Use these in `warden` chat mode after a run stops at `waiting_approval`. One-shot `warden run` does not preserve process state after exit, so approval/resume belongs in chat mode or HTTP server mode.

## Environment

WARDEN CLI/server processes automatically load `.env` from the project root when present. Create it from the example:

```bash
cp .env.example .env
```

Do not commit `.env`; it is ignored by `.gitignore`.

## Start

```bash
npm start
```

Default URL:

```text
http://127.0.0.1:8787
```

Use another port:

```bash
WARDEN_PORT=8790 npm start
```

## Create A Run

```bash
curl -sS -X POST http://127.0.0.1:8787/runs \
  -H 'content-type: application/json' \
  -d '{"objective":"방산 공급망 핵심 부품 수입 급감 원인을 분석해줘","maxIterations":2}'
```

The response contains a runtime `run.id`.

## Inspect Runs

```bash
curl -sS http://127.0.0.1:8787/runs
curl -sS http://127.0.0.1:8787/runs/<runId>
```

`GET /runs/:id` returns:

- runtime events
- model proposals
- MCP tool call records
- approval queue state
- WARDEN team output summary
- runtime answer with domain grounding and pending/approved evidence state

Secrets and bearer tokens are redacted before returning run details.

## Approve Or Reject

Approve a pending external action and resume the run:

```bash
curl -sS -X POST http://127.0.0.1:8787/runs/<runId>/approvals/<approvalId>/approve \
  -H 'content-type: application/json' \
  -d '{"actor":"operator","reason":"approved"}'
```

Reject it:

```bash
curl -sS -X POST http://127.0.0.1:8787/runs/<runId>/approvals/<approvalId>/reject \
  -H 'content-type: application/json' \
  -d '{"actor":"operator","reason":"rejected"}'
```

Approved `external_osint_fetch` currently resumes with deterministic local fixture evidence. It does not perform a live web request.

## Loop Behavior

Current runtime loop:

1. Create a queued runtime run.
2. Retrieve local Korea/Northeast Asia supply-chain grounding when the objective matches the domain classifier.
3. Ask the configured model adapter for a planner proposal.
4. Parse and validate the planner proposal against schema, capability allowlist, and blocked-risk rules.
5. Route the selected or deterministic fallback tool plan through policy and MCP router.
6. Run the internal WARDEN specialist team on the first iteration.
7. Hold external OSINT-style action as `waiting_approval` on later iterations.
8. On approval, attach deterministic local fetch evidence and clear the pending action.

This means the model can propose, but it cannot execute tools directly or override ACH, SourceVet, verifier, policy, or approval controls.

## Model Providers

Default:

```bash
WARDEN_MODEL_PROVIDER=mock npm start
```

OpenAI-compatible dry-run:

```bash
WARDEN_MODEL_PROVIDER=openai-compatible npm start
```

OpenAI-compatible live call:

```bash
export OPENAI_API_KEY=...
WARDEN_MODEL_PROVIDER=openai-compatible \
WARDEN_OPENAI_DRY_RUN=0 \
WARDEN_OPENAI_LIVE_OPT_IN=true \
npm start
```

Codex CLI dry-run:

```bash
WARDEN_MODEL_PROVIDER=codex npm start
```

Codex CLI live proposal path:

```bash
codex login
WARDEN_MODEL_PROVIDER=codex \
WARDEN_CODEX_DRY_RUN=0 \
npm start
```

WARDEN does not read Codex OAuth files directly. Codex authentication is handled by the Codex CLI.

If you want to authenticate Codex CLI with an API key instead of browser/device OAuth:

```bash
set -a
source .env
set +a
printenv OPENAI_API_KEY | codex login --with-api-key
```

## MCP Configuration

The runtime always exposes the internal `run_warden_team` capability. Optional stdio MCP servers can be loaded with:

```bash
WARDEN_MCP_CONFIG=fixtures/mcp/local-ach-server.json npm start
```

Remote MCP tools must be allowlisted in config and still pass policy. External-risk tools are approval-gated.

## Verification

```bash
npm run build
npm run demo:warden:cli
npm run demo:warden:runtime
npm run demo:warden:planner
npm run demo:warden:approval-resume
npm run demo:warden:domain
npm test
```

In restricted sandboxes, local port binding can require elevated execution. The runtime regression starts a local test server and checks `POST /runs`, polling, MCP tool events, model proposal events, approval pending behavior, and HTTP approval resume.
