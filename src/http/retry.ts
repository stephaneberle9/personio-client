import axios, { type AxiosError } from 'axios';

export interface RetryOptions {
  maxRetries: number;
  retryBaseMs: number;
  /** Injectable sleep, for tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Transient server statuses worth retrying (in addition to 429). */
const RETRYABLE_SERVER_STATUS = new Set([500, 502, 503, 504]);

/**
 * HTTP methods safe to replay: retrying these can only ever repeat an effect,
 * never compound one. A transient 5xx or dropped connection may fire *after*
 * the server applied a non-idempotent write, so `POST`/`PATCH` are excluded —
 * only 429 (which means the request was rejected, not processed) retries those.
 */
const IDEMPOTENT_METHODS = new Set(['get', 'head', 'options', 'put', 'delete']);

/** Parse a `Retry-After` header (delta-seconds form) into milliseconds. */
function retryAfterMs(headerValue: unknown): number | undefined {
  if (typeof headerValue !== 'string') return undefined;
  const seconds = Number(headerValue);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * Decide whether a thrown error is worth retrying:
 *   - `429` (rate limited) — always; the request was rejected, not processed.
 *   - transient `5xx` — only for idempotent methods.
 *   - no response at all (network reset / timeout) — only for idempotent methods.
 * Anything else (4xx other than 429, non-axios errors) propagates unchanged.
 */
function isRetryable(error: unknown): error is AxiosError {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === 429) return true;

  const method = (error.config?.method ?? 'get').toLowerCase();
  if (!IDEMPOTENT_METHODS.has(method)) return false;
  // No response → transport-level failure (ECONNRESET, timeout, DNS): retry.
  if (status === undefined) return true;
  return RETRYABLE_SERVER_STATUS.has(status);
}

/**
 * Run `fn`, retrying transient failures with exponential backoff: HTTP 429
 * (any method), and 5xx / network errors for idempotent methods. Honors a
 * numeric `Retry-After` header when present, otherwise backs off
 * `retryBaseMs * 2^n`. Non-retryable errors (or exhausting `maxRetries`)
 * propagate unchanged.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error) || attempt >= options.maxRetries) throw error;

      const headerDelay = retryAfterMs(error.response?.headers?.['retry-after']);
      const backoff = options.retryBaseMs * 2 ** attempt;
      await sleep(headerDelay ?? backoff);
      attempt += 1;
    }
  }
}
