import axios from 'axios';

export interface RetryOptions {
  maxRetries: number;
  retryBaseMs: number;
  /** Injectable sleep, for tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Parse a `Retry-After` header (delta-seconds form) into milliseconds. */
function retryAfterMs(headerValue: unknown): number | undefined {
  if (typeof headerValue !== 'string') return undefined;
  const seconds = Number(headerValue);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * Run `fn`, retrying on HTTP 429 with exponential backoff. Honors a numeric
 * `Retry-After` header when present, otherwise backs off `retryBaseMs * 2^n`.
 * Any non-429 error (or exhausting `maxRetries`) propagates unchanged.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const is429 = axios.isAxiosError(error) && error.response?.status === 429;
      if (!is429 || attempt >= options.maxRetries) throw error;

      const headerDelay = retryAfterMs(error.response?.headers?.['retry-after']);
      const backoff = options.retryBaseMs * 2 ** attempt;
      await sleep(headerDelay ?? backoff);
      attempt += 1;
    }
  }
}
