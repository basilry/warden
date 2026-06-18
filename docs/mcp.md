# WARDEN P5 MCP

The P5 stdio MCP path is a controlled local integration point.

Current behavior:

- Disabled servers return no tools.
- Enabled servers require a command.
- Commands must pass `commandAllowlist`.
- Tools must be listed in `allowTools`.
- Invocation uses one-shot JSON-RPC over stdio.
- Timeout and malformed responses fail closed.

Fixture:

```bash
npm run demo:warden:p5-regression
```

The fixture server lives at `fixtures/mcp/warden-stdio-fixture.mjs`.

Production MCP use still needs approval queue integration around remote invokes and stricter result schema validation.

## ACH MCP

ACH analysis is available as a local stdio MCP boundary.

Files:

- `src/mcp/ach/stdio-server.ts`
- `src/mcp/ach/tools.ts`
- `src/agent/mcp/ach-client.ts`
- `fixtures/mcp/ach-server.json`

Regression:

```bash
npm run demo:warden:ach-mcp
```

## OSINT MCP

OSINT collection is split behind explicit MCP tools. These tools are external-risk operations and require live opt-in in their local implementation.

Tools:

| Tool | Purpose |
|---|---|
| `search_news` | Natural-language news/web/RSS search through allowlisted providers. |
| `scrape_news` | HTTP fetch based HTML title/text/link extraction for approved URLs. |
| `discover_news` | Source discovery through search/RSS followed by HTML scrape of discovered URLs. |

Guardrails:

- `WARDEN_OSINT_LIVE_OPT_IN=true` is required.
- Search providers are loaded from `fixtures/osint/search-sources.json`.
- Search endpoints must match each source's `allowedDomains` and `allowedPaths`.
- HTML scrape only accepts `http`/`https` URLs.
- HTML scrape blocks localhost, private IP ranges, link-local addresses, and `.local` names.
- Results are unvetted until SourceVet promotes them for ACH rerun.

Fixtures:

```bash
npm run demo:warden:osint-search-mcp
npm run demo:warden:osint-discovery-mcp
npm run demo:warden:osint-scrape-mcp
npm run demo:warden:osint-provider-quality
npm run demo:warden:osint-mcp-boundary
```

Current limitation:

- `discover_news` uses configured search/RSS providers to find URLs, then uses the static HTTP/HTML extractor.
- `scrape_news` is a static HTTP/HTML extractor, not a JS-rendering browser scraper.
- Runtime resume can accept an OSINT MCP invoker, but the default local CLI path still keeps the existing connector fallback unless an invoker is injected.
