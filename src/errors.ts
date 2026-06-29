import axios from 'axios';

/**
 * Error thrown for any failed Personio API call. Carries the HTTP status, the
 * request path, and — for `403` responses — a scope-aware hint naming the
 * Personio access right / OAuth2 scope the credential is most likely missing.
 *
 * This mirrors and generalizes the scope-aware error messages developed on the
 * `personio-mcp-server` branch this client was extracted from: a `403` should
 * tell the caller *which* access right to grant, not just "access denied".
 */
export class PersonioApiError extends Error {
  /** HTTP status code, when the failure was an HTTP response. */
  readonly status?: number;
  /** Request path that failed (no query string with secrets). */
  readonly path?: string;
  /** Raw Personio error payload, if any (already free of credentials). */
  readonly details?: unknown;

  constructor(
    message: string,
    options: { status?: number; path?: string; details?: unknown; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = 'PersonioApiError';
    this.status = options.status;
    this.path = options.path;
    this.details = options.details;
  }
}

/**
 * The Personio access right (OAuth2 scope) a given resource path requires.
 * Used to turn an opaque `403` into an actionable message. Scope names follow
 * the `personio:<resource>:<action>` convention; verify the exact strings
 * against your account, as Personio's documentation is inconsistent here.
 */
const SCOPE_BY_RESOURCE: ReadonlyArray<{ match: RegExp; scope: string }> = [
  { match: /\/attendance-periods/, scope: 'personio:attendances:read' },
  { match: /\/absence-periods/, scope: 'personio:absences:read' },
  { match: /\/absence-types/, scope: 'personio:absences:read' },
  { match: /\/persons/, scope: 'personio:persons:read' },
  { match: /\/projects/, scope: 'personio:projects:read' },
  { match: /\/cost-centers/, scope: 'personio:cost-centers:read' },
  { match: /\/reports/, scope: 'personio:reports:read' },
  { match: /\/auth\/token/, scope: '(token request — check client id/secret and credential status)' },
];

/** Best-effort lookup of the scope a path needs, for 403 hinting. */
function scopeForPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return SCOPE_BY_RESOURCE.find((entry) => entry.match.test(path))?.scope;
}

/**
 * Extract a human-readable message from a Personio error payload without
 * leaking secrets. Personio uses several shapes across API generations.
 */
function extractApiMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return typeof data === 'string' ? data : undefined;
  const d = data as Record<string, any>;
  return (
    d.error?.message ??
    (typeof d.error === 'string' ? d.error : undefined) ??
    d.message ??
    d.detail ??
    undefined
  );
}

/**
 * Normalize any thrown value from an axios request into a {@link PersonioApiError}.
 * For `403`, appends a scope-aware hint naming the likely-missing access right.
 * Never includes the Authorization header or query string in the message.
 */
export function toPersonioApiError(error: unknown, path?: string): PersonioApiError {
  if (error instanceof PersonioApiError) return error;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const requestPath = path ?? new URL(error.config?.url ?? '', 'http://x').pathname;
    const apiMessage = extractApiMessage(error.response?.data) ?? error.message;

    if (status === 403) {
      const scope = scopeForPath(requestPath);
      const hint = scope
        ? ` Access denied — your Personio API credential is missing the access right for this resource (expected scope: ${scope}). Grant it to the credential and retry.`
        : ' Access denied — your Personio API credential lacks the required access right for this resource.';
      return new PersonioApiError(`Personio API error (403) on ${requestPath}: ${apiMessage}.${hint}`, {
        status,
        path: requestPath,
        details: error.response?.data,
        cause: error,
      });
    }

    return new PersonioApiError(
      `Personio API error${status ? ` (${status})` : ''} on ${requestPath}: ${apiMessage}`,
      { status, path: requestPath, details: error.response?.data, cause: error }
    );
  }

  return new PersonioApiError(
    `Personio client error: ${error instanceof Error ? error.message : String(error)}`,
    { path, cause: error }
  );
}
