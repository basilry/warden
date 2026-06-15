# FAQ

## Is WARDEN an autonomous defense agent?

No. WARDEN is a controlled harness. It limits model output to proposal-only and gates tools through policy, approval, deterministic analysis, verification, and audit.

## Does it call the internet by default?

No. The default demo and `npm test` are offline-first. External actions are approval-required.

## Does it use Codex OAuth?

It can use Codex-managed authentication through the Codex CLI adapter. WARDEN does not read OAuth tokens directly and does not use Codex access tokens as generic OpenAI API bearer tokens.

## Is it production ready?

No. It is a local MVP and submission-ready technical demo. Production use would require partner-specific security, identity, storage, network, deployment, and data-governance work.

## What is deterministic here?

ACH scoring, SourceVet checks, policy decisions, verifier checks, regression fixtures, persistence and bundle checks are deterministic in the local demo path.

## What would a partner PoC need?

Representative sanitized documents, RFI categories, approval policy, security constraints, and evaluation criteria.
