import axios, { type AxiosInstance } from 'axios';
import { PersonioApiError, toPersonioApiError } from '../errors.js';

/** Seconds before actual expiry at which a cached token is considered stale. */
const EXPIRY_BUFFER_SECONDS = 60;

/** Fallback lifetime when Personio omits `expires_in` (documented default: 1 day). */
const DEFAULT_EXPIRES_IN_SECONDS = 86_400;

export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  scopes?: string[];
  timeoutMs: number;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
}

interface CachedToken {
  accessToken: string;
  /** Absolute epoch-ms at which the token must be refreshed (incl. buffer). */
  refreshAt: number;
}

/**
 * OAuth2 *client credentials* token provider for the Personio v2 API.
 *
 * `POST /v2/auth/token` (form-urlencoded) → `{ access_token, expires_in, ... }`.
 * The token is cached in memory (never persisted — see concept §12) and shared
 * across concurrent callers via a single in-flight promise, then refreshed
 * {@link EXPIRY_BUFFER_SECONDS} before it expires.
 */
export class OAuthClient {
  private readonly http: AxiosInstance;
  private readonly now: () => number;
  private cached: CachedToken | null = null;
  private inflight: Promise<CachedToken> | null = null;

  constructor(private readonly options: OAuthClientOptions) {
    this.now = options.now ?? Date.now;
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
    });
  }

  /** Return a valid bearer token, refreshing it if missing or near expiry. */
  async getAccessToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.refreshAt) {
      return this.cached.accessToken;
    }
    // Coalesce concurrent refreshes into one network request.
    if (!this.inflight) {
      this.inflight = this.requestToken().finally(() => {
        this.inflight = null;
      });
    }
    this.cached = await this.inflight;
    return this.cached.accessToken;
  }

  /** `Authorization` header for an API request. */
  async getAuthHeader(): Promise<{ Authorization: string }> {
    return { Authorization: `Bearer ${await this.getAccessToken()}` };
  }

  /** Drop the cached token so the next call re-authenticates. */
  clearToken(): void {
    this.cached = null;
  }

  private async requestToken(): Promise<CachedToken> {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', this.options.clientId);
    params.append('client_secret', this.options.clientSecret);
    if (this.options.scopes?.length) {
      params.append('scope', this.options.scopes.join(' '));
    }

    try {
      const response = await this.http.post('/v2/auth/token', params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      });

      const accessToken: unknown = response.data?.access_token;
      if (typeof accessToken !== 'string' || accessToken.length === 0) {
        throw new PersonioApiError('Personio auth response did not contain an access_token', {
          path: '/v2/auth/token',
        });
      }

      const expiresIn =
        typeof response.data?.expires_in === 'number'
          ? response.data.expires_in
          : DEFAULT_EXPIRES_IN_SECONDS;
      const refreshAt =
        this.now() + Math.max(0, expiresIn - EXPIRY_BUFFER_SECONDS) * 1000;

      return { accessToken, refreshAt };
    } catch (error) {
      throw toPersonioApiError(error, '/v2/auth/token');
    }
  }
}
