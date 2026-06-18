import type {
  OsintProviderErrorKind,
  OsintProviderTelemetry,
  OsintProviderWarning,
  OsintProviderWarningKind,
  OsintSearchSource
} from "./search-types.ts";

const DEFAULT_RELIABILITY = "C3";
const DEFAULT_COOLDOWN_MS: Record<OsintProviderErrorKind, number> = {
  rate_limited: 60_000,
  timeout: 10_000,
  http_error: 15_000,
  config_invalid: 0,
  malformed_response: 0,
  unknown: 5_000
};
const MAX_COOLDOWN_MS = 5 * 60_000;

export class OsintProviderFetchError extends Error {
  readonly errorKind: OsintProviderErrorKind;
  readonly status?: number;

  constructor(errorKind: OsintProviderErrorKind, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "OsintProviderFetchError";
    this.errorKind = errorKind;
    this.status = options.status;
    if (options.cause) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export type OsintProviderQualityTracker = {
  beginAttempt(source: OsintSearchSource): { source: OsintSearchSource; startedAtMs: number };
  activeCooldown(source: OsintSearchSource): OsintProviderWarning | undefined;
  recordSuccess(attempt: { source: OsintSearchSource; startedAtMs: number }, runId: string): void;
  recordFailure(attempt: { source: OsintSearchSource; startedAtMs: number }, runId: string, error: unknown): OsintProviderWarning;
  recordCooldownSkip(source: OsintSearchSource, runId: string, warning: OsintProviderWarning): void;
  telemetry(): OsintProviderTelemetry[];
  warnings(): OsintProviderWarning[];
};

type ProviderState = {
  failureCount: number;
  cooldownUntilMs?: number;
};

export function createOsintProviderQualityTracker(nowMs: () => number = Date.now): OsintProviderQualityTracker {
  const states = new Map<string, ProviderState>();
  const providerTelemetry: OsintProviderTelemetry[] = [];
  const providerWarnings: OsintProviderWarning[] = [];

  return {
    beginAttempt(source) {
      return { source, startedAtMs: nowMs() };
    },
    activeCooldown(source) {
      const state = activeStateFor(source, states, nowMs());
      if (!state?.cooldownUntilMs || state.cooldownUntilMs <= nowMs()) return undefined;
      return buildWarning(source, "cooldown", `Provider ${source.id} is in cooldown until ${toIso(state.cooldownUntilMs)}.`, {
        cooldownUntil: toIso(state.cooldownUntilMs)
      });
    },
    recordSuccess(attempt, runId) {
      states.delete(providerKey(attempt.source));
      providerTelemetry.push({
        runId,
        sourceId: attempt.source.id,
        sourceKind: attempt.source.kind,
        attempted: true,
        failed: false,
        latencyMs: elapsedMs(attempt.startedAtMs, nowMs())
      });
    },
    recordFailure(attempt, runId, error) {
      const errorKind = classifyProviderError(error);
      const status = providerErrorStatus(error);
      const state = states.get(providerKey(attempt.source)) ?? { failureCount: 0 };
      state.failureCount += 1;
      const cooldownMs = cooldownMsFor(attempt.source, errorKind, state.failureCount);
      if (cooldownMs > 0) {
        state.cooldownUntilMs = nowMs() + cooldownMs;
      }
      states.set(providerKey(attempt.source), state);
      if (errorKind === "rate_limited" && attempt.source.rateLimitKey) {
        const shared = states.get(sharedRateLimitKey(attempt.source)) ?? { failureCount: 0 };
        shared.failureCount += 1;
        shared.cooldownUntilMs = Math.max(shared.cooldownUntilMs ?? 0, state.cooldownUntilMs ?? nowMs());
        states.set(sharedRateLimitKey(attempt.source), shared);
      }

      const message = providerErrorMessage(error);
      const warning = buildWarning(attempt.source, errorKind, `Provider ${attempt.source.id} ${errorKind}: ${message}`, {
        status,
        cooldownUntil: state.cooldownUntilMs ? toIso(state.cooldownUntilMs) : undefined
      });
      providerWarnings.push(warning);
      providerTelemetry.push({
        runId,
        sourceId: attempt.source.id,
        sourceKind: attempt.source.kind,
        attempted: true,
        failed: true,
        latencyMs: elapsedMs(attempt.startedAtMs, nowMs()),
        errorKind,
        status,
        failureCount: state.failureCount,
        cooldownMs,
        cooldownUntil: state.cooldownUntilMs ? toIso(state.cooldownUntilMs) : undefined,
        message
      });
      return warning;
    },
    recordCooldownSkip(source, runId, warning) {
      providerWarnings.push(warning);
      providerTelemetry.push({
        runId,
        sourceId: source.id,
        sourceKind: source.kind,
        attempted: false,
        failed: false,
        latencyMs: 0,
        message: warning.message,
        cooldownUntil: warning.cooldownUntil
      });
    },
    telemetry() {
      return [...providerTelemetry];
    },
    warnings() {
      return [...providerWarnings];
    }
  };
}

export function defaultReliabilityForSource(source: Pick<OsintSearchSource, "reliability">): string {
  return isAdmiraltyReliability(source.reliability) ? source.reliability : DEFAULT_RELIABILITY;
}

export function classifyProviderError(error: unknown): OsintProviderErrorKind {
  if (error instanceof OsintProviderFetchError) return error.errorKind;
  const message = providerErrorMessage(error);
  const name = isErrorLike(error) ? error.name : "";
  if (name === "AbortError" || /timed?\s*out|timeout/i.test(message)) return "timeout";
  if (/\bHTTP\s+429\b/i.test(message)) return "rate_limited";
  if (/\bHTTP\s+\d{3}\b/i.test(message)) return "http_error";
  if (/not configured|No fetch implementation|config/i.test(message)) return "config_invalid";
  if (/malformed|not valid JSON|did not expose/i.test(message)) return "malformed_response";
  return "unknown";
}

export function providerErrorStatus(error: unknown): number | undefined {
  if (error instanceof OsintProviderFetchError) return error.status;
  const match = providerErrorMessage(error).match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : undefined;
}

function cooldownMsFor(source: OsintSearchSource, errorKind: OsintProviderErrorKind, failureCount: number): number {
  const base = positiveInteger(source.cooldownMs) ?? DEFAULT_COOLDOWN_MS[errorKind];
  if (base <= 0) return 0;
  const multiplier = positiveNumber(source.backoffMultiplier) ?? 2;
  const scaled = Math.round(base * Math.pow(multiplier, Math.max(0, failureCount - 1)));
  return Math.min(scaled, MAX_COOLDOWN_MS);
}

function buildWarning(
  source: OsintSearchSource,
  kind: OsintProviderWarningKind,
  message: string,
  options: { status?: number; cooldownUntil?: string } = {}
): OsintProviderWarning {
  return {
    sourceId: source.id,
    sourceKind: source.kind,
    kind,
    message,
    status: options.status,
    cooldownUntil: options.cooldownUntil
  };
}

function providerKey(source: OsintSearchSource): string {
  return `${source.kind}:${source.id}`;
}

function sharedRateLimitKey(source: OsintSearchSource): string {
  return `${source.kind}:rate-limit:${source.rateLimitKey ?? source.id}`;
}

function activeStateFor(
  source: OsintSearchSource,
  states: Map<string, ProviderState>,
  nowMs: number
): ProviderState | undefined {
  const own = states.get(providerKey(source));
  const shared = source.rateLimitKey ? states.get(sharedRateLimitKey(source)) : undefined;
  const candidates = [own, shared].filter((state): state is ProviderState => Boolean(state?.cooldownUntilMs && state.cooldownUntilMs > nowMs));
  return candidates.sort((left, right) => (right.cooldownUntilMs ?? 0) - (left.cooldownUntilMs ?? 0))[0];
}

function elapsedMs(startedAtMs: number, endedAtMs: number): number {
  return Math.max(0, Math.round(endedAtMs - startedAtMs));
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isAdmiraltyReliability(value: unknown): value is string {
  return typeof value === "string" && /^[A-F][1-6]$/.test(value);
}

function providerErrorMessage(error: unknown): string {
  if (isErrorLike(error)) return error.message || error.name;
  return String(error);
}

function isErrorLike(error: unknown): error is Error {
  return Boolean(error) && typeof error === "object" && "message" in error;
}
