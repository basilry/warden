export type RedactionPolicy = {
  redactLargeStrings?: boolean;
  maxStringLength?: number;
  redactKeys?: RegExp[];
  redactValues?: RegExp[];
};

export const DEFAULT_REDACTION_POLICY: Required<RedactionPolicy> = {
  redactLargeStrings: true,
  maxStringLength: 500,
  redactKeys: [/api[-_]?key/i, /access[-_]?token/i, /authorization/i, /password/i, /secret/i, /cookie/i],
  redactValues: [
    /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    /\b(?:codex|sess|pat|ghp)_[A-Za-z0-9_-]{12,}\b/g,
    /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi
  ]
};

export function redactPayload(value: unknown, policy: RedactionPolicy = {}): unknown {
  const resolved = { ...DEFAULT_REDACTION_POLICY, ...policy };
  return redactValue(value, resolved, []);
}

export function assertNoSecretInPayload(value: unknown, policy: RedactionPolicy = {}): void {
  const resolved = { ...DEFAULT_REDACTION_POLICY, ...policy };
  const found = findSecret(value, resolved, []);
  if (found) {
    throw new Error(`Secret-like value found in payload at ${found}.`);
  }
}

export function redactText(value: string, policy: RedactionPolicy = {}): string {
  const resolved = { ...DEFAULT_REDACTION_POLICY, ...policy };
  let text = value;
  for (const pattern of resolved.redactValues) {
    text = text.replace(pattern, "[REDACTED]");
  }
  if (resolved.redactLargeStrings && text.length > resolved.maxStringLength) {
    return `${text.slice(0, resolved.maxStringLength)}...[TRUNCATED ${text.length - resolved.maxStringLength} chars]`;
  }
  return text;
}

function redactValue(value: unknown, policy: Required<RedactionPolicy>, path: string[]): unknown {
  if (typeof value === "string") {
    return redactText(value, policy);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, policy, [...path, String(index)]));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (policy.redactKeys.some((pattern) => pattern.test(key))) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactValue(child, policy, [...path, key]);
      }
    }
    return output;
  }
  return value;
}

function findSecret(value: unknown, policy: Required<RedactionPolicy>, path: string[]): string | undefined {
  if (typeof value === "string") {
    return policy.redactValues.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    })
      ? path.join(".") || "$"
      : undefined;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecret(value[index], policy, [...path, String(index)]);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (policy.redactKeys.some((pattern) => pattern.test(key))) {
        if (child !== "[REDACTED]") {
          return [...path, key].join(".");
        }
        continue;
      }
      const found = findSecret(child, policy, [...path, key]);
      if (found) return found;
    }
  }
  return undefined;
}
