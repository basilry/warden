#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = resolve(rootDir, "src/cli/warden.ts");
const args = [
  "--disable-warning=ExperimentalWarning",
  "--experimental-strip-types",
  entrypoint,
  ...process.argv.slice(2)
];

const child = spawn(process.execPath, args, {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  process.stderr.write(`Failed to start WARDEN CLI: ${error.message}\n`);
  process.exit(1);
});
