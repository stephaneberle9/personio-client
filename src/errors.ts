import axios from 'axios';

/**
 * Error thrown for any failed Personio API call. Carries the HTTP status, the
 * request path, and — when the status and path indicate a likely-missing access
 * right — a scope-aware hint naming the Personio access right / OAuth2 scope the
 * credential is most likely missing. A missing right does not always surface as
 * `403`: it also appears as `401` on `/v2/persons` and `400` on `/v2/reports`
 * (confirmed live), so the hint covers those too.
 *
 * This mirrors and generalizes the scope-aware error messages developed on the
 * `personio-mcp-server` branch this client was extracted from: an authorization
 * failure should tell the caller *which* access right to grant, not just
 * "access denied".
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

  /**
   * Serialize without the `cause`. The raw axios cause carries the request
   * config — including the `Authorization` bearer header and, on the auth-token
   * request, the `client_secret` in the body — so it must never reach logs or
   * JSON output. `toPersonioApiError` already attaches only a sanitized cause;
   * this is defense in depth for anything that serializes the error directly.
   */
  toJSON(): Record<string, unknown> {
    return { name: this.name, message: this.message, status: this.status, path: this.path };
  }
}

/**
 * Reduce an axios error to a credential-free cause: never the raw error (whose
 * `config` holds the bearer header and any request body, e.g. the auth
 * `client_secret`). Keeps only the transport code, status, and the response
 * body (a Personio error payload, which carries no request credentials).
 */
function sanitizedCause(error: unknown): unknown {
  if (axios.isAxiosError(error)) {
    return { code: error.code, status: error.response?.status, responseData: error.response?.data };
  }
  return error instanceof Error ? { name: error.name, message: error.message } : undefined;
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

/** Best-effort lookup of the scope a path needs, for scope-aware hinting. */
function scopeForPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return SCOPE_BY_RESOURCE.find((entry) => entry.match.test(path))?.scope;
}

/** The `/v2/auth/token` request, where a 401 really is a credential problem. */
function isAuthTokenPath(path: string | undefined): boolean {
  return !!path && /\/auth\/token/.test(path);
}

/** A `/v2/reports` request, where a 400 needs body-specific hinting. */
function isReportsPath(path: string | undefined): boolean {
  return !!path && /\/reports/.test(path);
}

/**
 * Hint for a `403`, or for a `401`/`400` that a scope probe showed is really a
 * missing access right in disguise. Names the expected scope when known.
 */
function missingAccessRightHint(scope: string | undefined): string {
  return scope
    ? ` Access denied — your Personio API credential is missing the access right for this resource (expected scope: ${scope}). Grant it to the credential and retry.`
    : ' Access denied — your Personio API credential lacks the required access right for this resource.';
}

/**
 * Hint for a `401` on a non-token path. A missing access right does not always
 * surface as `403`: confirmed live, `/v2/persons` returns `401 "Unauthorized
 * Request"` when the credential lacks the persons read right. So the cause is
 * ambiguous — an invalid/expired token *or* a missing right — and the hint says
 * so rather than pointing only at the token (which the bare 401 message implies).
 */
function ambiguousUnauthorizedHint(scope: string | undefined): string {
  const scopePart = scope ? ` (expected scope: ${scope})` : '';
  return (
    ` This likely means either an invalid or expired token, or that your Personio API credential` +
    ` is missing the access right for this resource${scopePart} — on this API a missing right does` +
    ` not always surface as 403 (observed live: /v2/persons returns 401 here). If the token is` +
    ` valid, grant the access right to the credential and retry.`
  );
}

/**
 * Hint for a `400` on `/v2/reports`, disambiguated by the response body. The
 * Reporting v2 endpoint overloads `400` for several unrelated causes (all
 * confirmed live) — a missing reports right, a grouped/chart report, a
 * shared-but-unreadable report, and a wrong id / missing API access — and its
 * own messages are ambiguous, so the hint is phrased as the most likely cause,
 * not a certainty.
 */
function reportsBadRequestHint(apiMessage: string, scope: string | undefined): string {
  if (/unauthorized token/i.test(apiMessage)) {
    const scopePart = scope ? ` (expected scope: ${scope})` : '';
    return (
      ` This most likely means your Personio API credential lacks the reports read access right` +
      `${scopePart} — the API reports a missing reports right as 400 "Unauthorized token" rather` +
      ` than 403. Grant the reports read right to the credential and retry.`
    );
  }
  if (/unsupported nested type/i.test(apiMessage)) {
    return (
      ` This report is most likely built with chart grouping and cannot be read through the API —` +
      ` only flat table reports are readable, and the report list's chart_type is not a reliable` +
      ` indicator (grouped reports still report "table"). Rebuild it as a flat table report to` +
      ` export it via the API.`
    );
  }
  if (/no element matching the predicate/i.test(apiMessage)) {
    return (
      ` The report is most likely shared and appears in GET /v2/reports, but Personio still cannot` +
      ` read it for a flat export — most likely it is grouped/aggregated or carries a report` +
      ` filter/timeframe the /v2/reports/{id} read cannot resolve (the same limitation as` +
      ` "unsupported nested type"). Rebuild it as a flat, ungrouped table report, or read the same` +
      ` data via the granular ApiSource instead. Cross-check with scripts/list-reports.ts: if the id` +
      ` appears there, this is a report-structure problem, not a wrong id or missing access right.`
    );
  }
  return (
    ` This is most likely either a wrong report id, or the report does not have API access` +
    ` activated. API access is a per-report toggle in Personio (the report's "API access" /` +
    ` "API-Zugriff" column), separate from both the reports read scope and from sharing the report` +
    ` with people (its "shared"/"private" status) — a report without API access activated may not` +
    ` appear in GET /v2/reports at all. Verify the id and that API access is activated for the` +
    ` report, then retry.`
  );
}

/**
 * Extract a human-readable message from a Personio error payload without
 * leaking secrets. Personio uses several shapes across API generations,
 * including a JSON:API-style `{ errors: [{ title, detail }] }` envelope
 * (confirmed on `/v2/reports`).
 */
function extractApiMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return typeof data === 'string' ? data : undefined;
  const d = data as Record<string, any>;
  const firstError = Array.isArray(d.errors) ? d.errors[0] : undefined;
  return (
    d.error?.message ??
    (typeof d.error === 'string' ? d.error : undefined) ??
    d.message ??
    d.detail ??
    firstError?.detail ??
    firstError?.title ??
    undefined
  );
}

/**
 * Normalize any thrown value from an axios request into a {@link PersonioApiError}.
 * Appends a best-effort, scope-aware hint when the status and path indicate a
 * likely-missing access right — not only on `403`, since a missing right also
 * surfaces as `401` on `/v2/persons` and `400` on `/v2/reports` (confirmed
 * live). All hints are
 * phrased as likelihoods because the API's own messages are ambiguous. Never
 * includes the Authorization header or query string in the message.
 */
export function toPersonioApiError(error: unknown, path?: string): PersonioApiError {
  if (error instanceof PersonioApiError) return error;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const requestPath = path ?? new URL(error.config?.url ?? '', 'http://x').pathname;
    const apiMessage = extractApiMessage(error.response?.data) ?? error.message;

    const withHint = (hint: string): PersonioApiError =>
      new PersonioApiError(`Personio API error (${status}) on ${requestPath}: ${apiMessage}.${hint}`, {
        status,
        path: requestPath,
        details: error.response?.data,
        cause: sanitizedCause(error),
      });

    if (status === 403) {
      return withHint(missingAccessRightHint(scopeForPath(requestPath)));
    }

    // A missing right on the persons endpoint comes back as 401, whose bare
    // message reads like a bad token — hint that it may be a missing right too.
    // The token request's own 401 is genuinely a credential problem: unchanged.
    if (status === 401 && !isAuthTokenPath(requestPath)) {
      return withHint(ambiguousUnauthorizedHint(scopeForPath(requestPath)));
    }

    // The reports endpoint overloads 400 for a missing right, a grouped/chart
    // report, and a wrong id / a report without API access activated —
    // disambiguate by the body. Other 400s (and 400s on any other endpoint)
    // keep the plain, unhinted message.
    if (status === 400 && isReportsPath(requestPath)) {
      return withHint(reportsBadRequestHint(apiMessage, scopeForPath(requestPath)));
    }

    return new PersonioApiError(
      `Personio API error${status ? ` (${status})` : ''} on ${requestPath}: ${apiMessage}`,
      { status, path: requestPath, details: error.response?.data, cause: sanitizedCause(error) }
    );
  }

  return new PersonioApiError(
    `Personio client error: ${error instanceof Error ? error.message : String(error)}`,
    { path, cause: error }
  );
}
