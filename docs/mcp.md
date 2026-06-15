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
