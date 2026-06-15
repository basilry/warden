import { loadDotEnvFile } from "../agent/env.ts";
import { loadWardenConfig } from "../agent/config.ts";
import { createWardenRuntimeServer, renderServerBanner } from "./server.ts";

loadDotEnvFile();
const port = parsePort(process.env.WARDEN_PORT ?? "8787");
const config = loadWardenConfig();
const { server } = createWardenRuntimeServer({ config });

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`${renderServerBanner(port, config)}\n`);
});

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`올바르지 않은 WARDEN_PORT 값입니다: ${value}`);
  }
  return port;
}
