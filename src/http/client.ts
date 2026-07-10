import axios, { type AxiosInstance } from 'axios';
import { OAuthClient } from '../auth/oauth-client.js';
import { PersonioApiError, toPersonioApiError } from '../errors.js';
import { withRetry } from './retry.js';
import { RateLimiter, parseRateLimitHeaders, bucketKeyForPath } from './rate-limiter.js';
import { normalizePage, type Page } from './paginate.js';

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  auth: OAuthClient;
  maxRetries: number;
  retryBaseMs: number;
  /**
   * Steady-state *floor* for the adaptive throttle (ms): the spacing used while
   * the account is healthy. The limiter widens beyond it on 429s and relaxes
   * back to it on success. `0`/omitted means full speed until the API pushes
   * back. See {@link ClientConfig.minRequestIntervalMs}.
   */
  minRequestIntervalMs?: number;
  /** Injectable sleep for retry backoff and throttle, for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for the throttle, for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/** Query parameter values accepted by the request helpers. */
export type QueryValue = string | number | boolean | undefined | null;
export type QueryParams = Record<string, QueryValue | Array<string | number>>;

/** Per-request options shared by the verbs. */
export interface RequestOptions {
  params?: QueryParams;
  /** Extra headers (e.g. `{ Beta: 'true' }` for Personio beta endpoints). */
  headers?: Record<string, string>;
}

/** Personio v2's hard maximum page size for list endpoints. */
export const MAX_PAGE_SIZE = 100;

/**
 * Thin axios wrapper shared by every endpoint. Adds the bearer token via a
 * request interceptor (carried over from the original mcp-server client),
 * normalizes errors to {@link PersonioApiError} with scope-aware 403 hints,
 * paces requests through a per-endpoint rate limiter, retries transient failures
 * (429 / 5xx / network), and follows cursor pagination over `_meta.links.next`.
 */
export class HttpClient {
  private readonly axios: AxiosInstance;
  private readonly options: HttpClientOptions;
  private readonly limiter: RateLimiter;

  constructor(options: HttpClientOptions) {
    this.options = options;
    this.limiter = new RateLimiter({
      floorMs: options.minRequestIntervalMs ?? 0,
      now: options.now,
      sleep: options.sleep,
    });
    this.axios = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      headers: { Accept: 'application/json' },
    });

    // Pace each request through its per-endpoint bucket, then inject the OAuth
    // bearer token. Runs for every verb and pagination follow-up, since all
    // share this instance.
    this.axios.interceptors.request.use(async (config) => {
      await this.limiter.acquire(this.bucketKey(config.url));
      const header = await options.auth.getAuthHeader();
      config.headers.set('Authorization', header.Authorization);
      return config;
    });

    // Feed every response back to its bucket so it can pace itself: from the
    // token-bucket headers when Personio sends them, else reactively from the
    // status. Network errors (no response) carry no rate signal, so skip them.
    this.axios.interceptors.response.use(
      (response) => {
        this.limiter.observe(
          this.bucketKey(response.config.url),
          response.status,
          parseRateLimitHeaders(response.headers as Record<string, unknown>)
        );
        return response;
      },
      (error) => {
        if (axios.isAxiosError(error) && error.response) {
          this.limiter.observe(
            this.bucketKey(error.config?.url),
            error.response.status,
            parseRateLimitHeaders(error.response.headers as Record<string, unknown>)
          );
        }
        return Promise.reject(error);
      }
    );
  }

  /** Rate-limit bucket key for a request URL (relative or absolute). */
  private bucketKey(url: string | undefined): string {
    return bucketKeyForPath(new URL(url ?? '', this.options.baseUrl).pathname);
  }

  /** Current steady-state throttle spacing (ms) for an endpoint path. Introspection. */
  throttleIntervalMs(path: string): number {
    return this.limiter.intervalMsFor(this.bucketKey(path));
  }

  /**
   * Run a raw axios call under {@link withRetry} (which retries on 429), then
   * normalize any failure to a {@link PersonioApiError} at the boundary. The
   * conversion must happen *outside* `withRetry` so the retry loop still sees
   * the raw {@link import('axios').AxiosError} and can detect the 429 status —
   * converting inside would hide it behind `PersonioApiError` and defeat the
   * backoff entirely.
   */
  private async withRetryConverting<T>(path: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await withRetry(fn, this.options);
    } catch (error) {
      throw toPersonioApiError(error, path);
    }
  }

  /** GET a single resource (or one raw list page). Returns the raw body. */
  async get<T = unknown>(path: string, params?: QueryParams, opts?: RequestOptions): Promise<T> {
    return this.withRetryConverting(path, async () => {
      const response = await this.axios.get<T>(path, {
        params: buildParams(params ?? opts?.params),
        headers: opts?.headers,
      });
      return response.data;
    });
  }

  /** GET binary content (e.g. a document download) as a Buffer. */
  async getBinary(path: string, opts?: RequestOptions): Promise<Buffer> {
    return this.withRetryConverting(path, async () => {
      const response = await this.axios.get(path, {
        params: buildParams(opts?.params),
        headers: opts?.headers,
        responseType: 'arraybuffer',
      });
      return Buffer.from(response.data as ArrayBuffer);
    });
  }

  /** POST a JSON (or FormData) body. */
  async post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.withRetryConverting(path, async () => {
      const response = await this.axios.post<T>(path, body, {
        params: buildParams(opts?.params),
        headers: opts?.headers,
      });
      return response.data;
    });
  }

  /** PATCH a JSON body. */
  async patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.withRetryConverting(path, async () => {
      const response = await this.axios.patch<T>(path, body, {
        params: buildParams(opts?.params),
        headers: opts?.headers,
      });
      return response.data;
    });
  }

  /** DELETE a resource. */
  async delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.withRetryConverting(path, async () => {
      const response = await this.axios.delete<T>(path, {
        params: buildParams(opts?.params),
        headers: opts?.headers,
      });
      return response.data;
    });
  }

  /** GET one normalized list page (`_data` + `next` link). */
  async getPage<T = unknown>(
    path: string,
    params?: QueryParams,
    opts?: RequestOptions
  ): Promise<Page<T>> {
    return normalizePage<T>(await this.get(path, params, opts));
  }

  /** GET an absolute URL (used to follow a pagination `next` link). */
  private async getUrl<T = unknown>(url: string, headers?: Record<string, string>): Promise<T> {
    const path = new URL(url, this.options.baseUrl).pathname;
    return this.withRetryConverting(path, async () => {
      const response = await this.axios.get<T>(url, { headers });
      return response.data;
    });
  }

  /**
   * Follow cursor pagination from `path` until exhausted, returning every item.
   * The first page is requested with `params`; subsequent pages follow the
   * absolute `_meta.links.next.href`, which already carries the cursor.
   *
   * A hard page cap guards against a misbehaving API that never signals the
   * last page; it is far above any realistic result set.
   */
  async getAll<T = unknown>(
    path: string,
    params?: QueryParams,
    opts?: RequestOptions
  ): Promise<T[]> {
    const all: T[] = [];
    let page: Page<T> = normalizePage<T>(await this.get(path, params, opts));
    all.push(...page.data);

    const baseOrigin = new URL(this.options.baseUrl).origin;
    for (let guard = 0; page.nextHref && guard < 10_000; guard++) {
      // Never follow a pagination link to a foreign origin: the request carries
      // the bearer token, so a tampered `next` href would leak it (SSRF). Only
      // same-origin links (the API's own cursor) are honored.
      const next = new URL(page.nextHref, this.options.baseUrl);
      if (next.origin !== baseOrigin) {
        throw new PersonioApiError(
          `Refusing to follow pagination link to a foreign origin (${next.origin})`,
          { path }
        );
      }
      page = normalizePage<T>(await this.getUrl(next.toString(), opts?.headers));
      all.push(...page.data);
    }
    return all;
  }
}

/**
 * Flatten {@link QueryParams} into axios params, expanding arrays into repeated
 * keys (`person.id=a&person.id=b`) and dropping `null`/`undefined`. Personio v2
 * filters use dotted keys (`start.date_time.gte`) passed through verbatim.
 */
function buildParams(params?: QueryParams): URLSearchParams | undefined {
  if (!params) return undefined;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  return search;
}
