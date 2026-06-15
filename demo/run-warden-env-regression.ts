import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWardenConfig } from "../src/agent/config.ts";
import { loadDotEnvFile, parseDotEnv } from "../src/agent/env.ts";

const parsed = parseDotEnv(`
# comment
WARDEN_MODEL_PROVIDER=codex
WARDEN_CODEX_DRY_RUN=0
QUOTED="hello world"
INLINE=value # ignored
export WARDEN_PORT=8799
`);

assertEqual(parsed.WARDEN_MODEL_PROVIDER, "codex", "provider parse");
assertEqual(parsed.WARDEN_CODEX_DRY_RUN, "0", "dry-run parse");
assertEqual(parsed.QUOTED, "hello world", "quoted parse");
assertEqual(parsed.INLINE, "value", "inline comment parse");
assertEqual(parsed.WARDEN_PORT, "8799", "export parse");

const dir = mkdtempSync(join(tmpdir(), "warden-env-"));
try {
  writeFileSync(
    join(dir, ".env"),
    [
      "WARDEN_MODEL_PROVIDER=codex",
      "WARDEN_CODEX_DRY_RUN=0",
      "WARDEN_CODEX_SANDBOX=read-only",
      "OPENAI_API_KEY=codex-test-key"
    ].join("\n")
  );
  const env: NodeJS.ProcessEnv = {};
  const result = loadDotEnvFile(dir, env);
  assertEqual(result.loaded, true, "dotenv loaded");
  assertEqual(env.OPENAI_API_KEY, "codex-test-key", "dotenv process env merge");

  const config = loadWardenConfig(env, dir);
  assertEqual(config.model.provider, "codex", "config provider");
  assertEqual(config.model.codex.dryRun, false, "config dry run");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("Environment regression: passed");

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
