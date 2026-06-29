import axios, { type AxiosInstance } from 'axios';
import { OAuthClient } from '../auth/oauth-client.js';
import { toPersonioApiError } from '../errors.js';
import { withRetry } from './retry.js';
import { normalizePage, type Page } from './paginate.js';

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  auth: OAuthClient;
  maxRetries: number;
  retryBaseMs: number;
  /** Injectable sleep for retry backoff, for tests. */
  sleep?: (ms: number) => Promise<void>;
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
 * retries on 429, and follows cursor pagination over `_meta.links.next`.
 */
export class HttpClient {
  private readonly axios: AxiosInstance;
  private readonly options: HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.options = options;
    this.axios = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      headers: { Accept: 'application/json' },
    });

    // Inject the OAuth bearer token on every request.
    this.axios.interceptors.request.use(async (config) => {
      const header = await options.auth.getAuthHeader();
      config.headers.set('Authorization', header.Authorization);
      return config;
    });
  }

  /** GET a single resource (or one raw list page). Returns the raw body. */
  async get<T = unknown>(path: string, params?: QueryParams, opts?: RequestOptions): Promise<T> {
    return withRetry(async () => {
      try {
        const response = await this.axios.get<T>(path, {
          params: buildParams(params ?? opts?.params),
          headers: opts?.headers,
        });
        return response.data;
      } catch (error) {
        throw toPersonioApiError(error, path);
      }
    }, this.options);
  }

  /** GET binary content (e.g. a document download) as a Buffer. */
  async getBinary(path: string, opts?: RequestOptions): Promise<Buffer> {
    return withRetry(async () => {
      try {
        const response = await this.axios.get(path, {
          params: buildParams(opts?.params),
          headers: opts?.headers,
          responseType: 'arraybuffer',
        });
        return Buffer.from(response.data as ArrayBuffer);
      } catch (error) {
        throw toPersonioApiError(error, path);
      }
    }, this.options);
  }

  /** POST a JSON (or FormData) body. */
  async post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return withRetry(async () => {
      try {
        const response = await this.axios.post<T>(path, body, {
          params: buildParams(opts?.params),
          headers: opts?.headers,
        });
        return response.data;
      } catch (error) {
        throw toPersonioApiError(error, path);
      }
    }, this.options);
  }

  /** PATCH a JSON body. */
  async patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return withRetry(async () => {
      try {
        const response = await this.axios.patch<T>(path, body, {
          params: buildParams(opts?.params),
          headers: opts?.headers,
        });
        return response.data;
      } catch (error) {
        throw toPersonioApiError(error, path);
      }
    }, this.options);
  }

  /** DELETE a resource. */
  async delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return withRetry(async () => {
      try {
        const response = await this.axios.delete<T>(path, {
          params: buildParams(opts?.params),
          headers: opts?.headers,
        });
        return response.data;
      } catch (error) {
        throw toPersonioApiError(error, path);
      }
    }, this.options);
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
    return withRetry(async () => {
      try {
        const response = await this.axios.get<T>(url, { headers });
        return response.data;
      } catch (error) {
        throw toPersonioApiError(error, new URL(url, this.options.baseUrl).pathname);
      }
    }, this.options);
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

    for (let guard = 0; page.nextHref && guard < 10_000; guard++) {
      page = normalizePage<T>(await this.getUrl(page.nextHref, opts?.headers));
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
