# WARDEN Auth

WARDEN keeps model authentication outside the harness. The harness stores audit state, policy decisions, and model proposals, but it does not read or persist Codex credentials.

## Providers

```bash
WARDEN_MODEL_PROVIDER=mock
WARDEN_MODEL_PROVIDER=openai-compatible
WARDEN_MODEL_PROVIDER=codex
```

`mock` remains the default for deterministic offline demos.

## Codex CLI Auth

The `codex` provider launches `codex exec` through the local Codex CLI. Authentication is handled by Codex itself:

- cached `codex login`
- `codex login --device-auth`
- `codex login --with-api-key`, which reads an API key from stdin

WARDEN does not read `~/.codex/auth.json`, does not parse OAuth tokens, and does not use Codex credentials as generic OpenAI API bearer tokens.

The repo now loads `.env` automatically for WARDEN CLI/server processes. Copy `.env.example` to `.env` and edit it:

```bash
cp .env.example .env
```

For normal local Codex OAuth, do not paste a key into WARDEN. Run:

```bash
codex login
WARDEN_MODEL_PROVIDER=codex WARDEN_CODEX_DRY_RUN=0 warden run "..."
```

For API-key login through the Codex CLI:

```bash
set -a
source .env
set +a
printenv OPENAI_API_KEY | codex login --with-api-key
WARDEN_MODEL_PROVIDER=codex WARDEN_CODEX_DRY_RUN=0 warden run "..."
```

For WARDEN's OpenAI-compatible provider, WARDEN reads `OPENAI_API_KEY` directly only when live mode is explicitly enabled:

```bash
WARDEN_MODEL_PROVIDER=openai-compatible
WARDEN_OPENAI_DRY_RUN=0
WARDEN_OPENAI_LIVE_OPT_IN=true
OPENAI_API_KEY=...
```

## Dry Run

The Codex provider defaults to dry-run mode:

```bash
npm run demo:warden:codex
```

Live Codex execution requires explicit opt-in:

```bash
codex login
WARDEN_CODEX_DRY_RUN=0 npm run demo:warden:codex
```

For headless environments, use Codex device auth or an approved Codex access token:

```bash
codex login --device-auth
printenv OPENAI_API_KEY | codex login --with-api-key
```

## Runtime Controls

```bash
WARDEN_CODEX_COMMAND=codex
WARDEN_CODEX_MODEL=gpt-5.4
WARDEN_CODEX_SANDBOX=read-only
WARDEN_CODEX_TIMEOUT_MS=120000
WARDEN_CODEX_CWD=.
```

`read-only` is the recommended sandbox for model proposals. WARDEN still treats live Codex output as a proposal only; policy, approval, deterministic tools, and verification remain authoritative.
