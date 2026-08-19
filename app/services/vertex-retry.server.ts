/**
 * Explicit retry policy for Vertex AI calls.
 *
 * `@google/genai` has built-in retry behavior, but we wrap it so we control
 * which statuses are retryable, the backoff schedule, and which call sites
 * opt in. Streaming calls MUST NOT use this — partial responses are not
 * idempotent.
 *
 * See docs/enterprise.md §8.3.
 */

export interface VertexErrorClassification {
  retryable: boolean;
  status?: number;
}

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPIPE",
]);

/** Decide whether a failed Vertex call should be retried. */
export function classifyVertexError(err: unknown): VertexErrorClassification {
  if (err === null || typeof err !== "object") return { retryable: false };
  const e = err as { status?: number; code?: number | string };

  // SDK-style HTTP status (preferred)
  if (typeof e.status === "number") {
    const retryable = e.status === 429 || e.status === 408 || e.status >= 500;
    return { retryable, status: e.status };
  }

  // gRPC-style numeric code
  if (typeof e.code === "number") {
    // 4=DEADLINE_EXCEEDED, 8=RESOURCE_EXHAUSTED, 13=INTERNAL, 14=UNAVAILABLE
    if (e.code === 4 || e.code === 8 || e.code === 13 || e.code === 14) {
      return { retryable: true };
    }
    return { retryable: false };
  }

  // Node network errors
  if (typeof e.code === "string" && RETRYABLE_NETWORK_CODES.has(e.code)) {
    return { retryable: true };
  }

  return { retryable: false };
}

export interface RetryOptions {
  /** Total attempts = maxRetries + 1. Default 2 (so up to 3 attempts). */
  maxRetries?: number;
  /** Base delay between attempts. Default 10s. */
  baseDelayMs?: number;
  /** Override sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional hook for telemetry — called for every retry attempt. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/**
 * Wrap a Vertex call (non-streaming) with the standard enterprise retry policy.
 * Throws the last error if all attempts fail.
 */
export async function callWithVertexRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 10_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const { retryable } = classifyVertexError(err);
      if (!retryable || attempt === maxRetries) throw err;
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      options.onRetry?.({ attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  // Unreachable: the loop either returns or throws.
  throw lastErr;
}
