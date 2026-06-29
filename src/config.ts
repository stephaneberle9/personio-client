import { z } from 'zod';

/**
 * Runtime configuration for {@link PersonioClient}. Everything account- or
 * evaluation-specific (credentials, scopes, report id, custom field names) is
 * supplied here at runtime — nothing is hardcoded in the library.
 */
export const clientConfigSchema = z.object({
  /** OAuth2 client id of the Personio API credential (e.g. `papi-...`). */
  clientId: z.string().min(1, 'clientId is required'),
  /** OAuth2 client secret of the Personio API credential. */
  clientSecret: z.string().min(1, 'clientSecret is required'),
  /** API base URL. Defaults to the German Personio host. */
  baseUrl: z.string().url().default('https://api.personio.de'),
  /**
   * OAuth2 scopes to request. When omitted, Personio grants every scope the
   * credential is entitled to. Provide them explicitly to follow least
   * privilege, e.g. `['personio:attendances:read', 'personio:absences:read']`.
   */
  scopes: z.array(z.string()).optional(),
  /** Per-request timeout in milliseconds. */
  timeoutMs: z.number().int().positive().default(30_000),
  /** Maximum retry attempts on HTTP 429 (rate limit). */
  maxRetries: z.number().int().min(0).default(3),
  /** Base backoff in milliseconds for 429 retries (exponential). */
  retryBaseMs: z.number().int().positive().default(500),
});

export type ClientConfig = z.input<typeof clientConfigSchema>;
export type ResolvedClientConfig = z.output<typeof clientConfigSchema>;

/**
 * Build a {@link ResolvedClientConfig} from `process.env`. Reads
 * `PERSONIO_CLIENT_ID`, `PERSONIO_CLIENT_SECRET`, and the optional
 * `PERSONIO_BASE_URL` / `PERSONIO_SCOPES`. The example scripts call this after
 * loading `.env`; the library itself never reads the environment implicitly.
 */
export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ResolvedClientConfig {
  const scopes = env.PERSONIO_SCOPES?.trim()
    ? env.PERSONIO_SCOPES.trim().split(/\s+/)
    : undefined;

  return clientConfigSchema.parse({
    clientId: env.PERSONIO_CLIENT_ID ?? '',
    clientSecret: env.PERSONIO_CLIENT_SECRET ?? '',
    baseUrl: env.PERSONIO_BASE_URL || undefined,
    scopes,
  });
}
