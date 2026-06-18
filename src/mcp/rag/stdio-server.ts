#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { dispatchUnknownRagToolCall } from "./tools.ts";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string;
  method?: string;
  params?: {
    name?: unknown;
    arguments?: unknown;
  };
};

stdin.setEncoding("utf8");

let buffer = "";
stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    handleLine(line);
  }
});

function handleLine(line: string): void {
  const request = parseRequest(line);
  const id = typeof request.id === "string" ? request.id : "unknown";
  try {
    if (request.method !== "tools/call") {
      throw new Error(`Unsupported MCP method: ${String(request.method)}`);
    }
    const toolName = request.params?.name;
    if (typeof toolName !== "string") {
      throw new Error("RAG MCP tools/call requires params.name.");
    }
    const result = dispatchUnknownRagToolCall(toolName, request.params?.arguments);
    writeResponse({ jsonrpc: "2.0", id, result });
  } catch (error) {
    writeResponse({
      jsonrpc: "2.0",
      id,
      error: {
        message: (error as Error).message
      }
    });
  }
}

function parseRequest(line: string): JsonRpcRequest {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? (parsed as JsonRpcRequest) : {};
  } catch (error) {
    return {
      id: "unknown",
      method: "malformed",
      params: {
        arguments: {
          error: (error as Error).message
        }
      }
    };
  }
}

function writeResponse(response: unknown): void {
  stdout.write(`${JSON.stringify(response)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
