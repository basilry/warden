import type { OsintConnectorConfig } from "./types.ts";

export type OsintFetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
) => Promise<OsintHttpResponse>;

export type OsintHttpResponse = {
  ok: boolean;
  status: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

export type OsintHttpFetchOptions = {
  fetchImpl?: OsintFetchLike;
  now?: string;
};

export type OsintJsonResponse = {
  sourceUri: string;
  status: number;
  capturedAt: string;
  payload: unknown;
};

export class OsintHttpClientError extends Error {
  readonly code: "timeout" | "http_error" | "malformed_response" | "config_invalid";

  constructor(code: OsintHttpClientError["code"], message: string) {
    super(message);
    this.name = "OsintHttpClientError";
    this.code = code;
  }
}

export async function fetchOsintJson(
  sourceUrl: string,
  config: Pick<OsintConnectorConfig, "timeoutMs" | "userAgent">,
  options: OsintHttpFetchOptions = {}
): Promise<OsintJsonResponse> {
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new OsintHttpClientError("config_invalid", "OSINT timeoutMs must be a positive integer.");
  }
  const fetchImpl = options.fetchImpl ?? getGlobalFetch();
  if (!fetchImpl) {
    throw new OsintHttpClientError("config_invalid", "No fetch implementation is available for live OSINT.");
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new OsintHttpClientError("timeout", `OSINT fetch timed out after ${config.timeoutMs}ms.`));
    }, config.timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(sourceUrl, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": config.userAgent
        },
        signal: controller.signal
      }),
      timeoutPromise
    ]);
    if (!response.ok) {
      throw new OsintHttpClientError(
        "http_error",
        `OSINT source returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`
      );
    }
    return {
      sourceUri: sourceUrl,
      status: response.status,
      capturedAt: options.now ?? new Date().toISOString(),
      payload: await parseJsonResponse(response)
    };
  } catch (error) {
    if (error instanceof OsintHttpClientError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new OsintHttpClientError("timeout", `OSINT fetch timed out after ${config.timeoutMs}ms.`);
    }
    throw new OsintHttpClientError("http_error", (error as Error).message);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function parseJsonResponse(response: OsintHttpResponse): Promise<unknown> {
  try {
    if (response.json) return await response.json();
    if (response.text) return JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new OsintHttpClientError("malformed_response", `OSINT response was not valid JSON: ${(error as Error).message}`);
  }
  throw new OsintHttpClientError("malformed_response", "OSINT response did not expose json() or text().");
}

function getGlobalFetch(): OsintFetchLike | undefined {
  if (typeof globalThis.fetch !== "function") return undefined;
  return globalThis.fetch as unknown as OsintFetchLike;
}
