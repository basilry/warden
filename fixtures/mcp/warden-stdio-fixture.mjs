#!/usr/bin/env node

const modeIndex = process.argv.indexOf("--mode");
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : "echo";

process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const newline = buffer.indexOf("\n");
  if (newline === -1) return;
  const line = buffer.slice(0, newline);
  handle(line).catch((error) => {
    process.stdout.write(JSON.stringify({ id: "unknown", error: { message: error.message } }) + "\n");
  });
});

async function handle(line) {
  if (mode === "slow") {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (mode === "malformed") {
    process.stdout.write("{not-json\n");
    return;
  }

  const request = JSON.parse(line);
  if (request.method !== "tools/call") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { message: "unsupported method" } }) + "\n");
    return;
  }
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tool: request.params?.name,
        arguments: request.params?.arguments ?? {},
        fixture: true
      }
    }) + "\n"
  );
}
