import { newId } from "../ids.ts";

export type McpRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
};

export type McpResponse = {
  jsonrpc?: "2.0";
  id?: string;
  result?: unknown;
  error?: {
    code?: number;
    message: string;
  };
};

export function createMcpRequest(method: string, params?: unknown): McpRequest {
  return {
    jsonrpc: "2.0",
    id: newId("mcp_req"),
    method,
    params
  };
}

export function encodeMcpMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseMcpResponse(line: string, expectedId?: string): McpResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`Malformed MCP response JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) {
    throw new Error("Malformed MCP response: expected object.");
  }
  const response = parsed as McpResponse;
  if (expectedId && response.id !== expectedId) {
    throw new Error(`MCP response id mismatch: expected=${expectedId} actual=${String(response.id)}`);
  }
  if (response.error && typeof response.error.message !== "string") {
    throw new Error("Malformed MCP error response.");
  }
  if (!response.error && !("result" in response)) {
    throw new Error("Malformed MCP response: missing result.");
  }
  return response;
}

export function extractToolResult(response: McpResponse): unknown {
  if (response.error) {
    throw new Error(`MCP error: ${response.error.message}`);
  }
  return response.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
