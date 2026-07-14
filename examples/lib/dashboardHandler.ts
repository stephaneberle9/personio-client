/**
 * Request-handling core for `serve-dashboard.ts`, kept separate from the HTTP
 * wiring so it can be unit-tested without a socket. `handleAttendanceRequest`
 * turns a parsed query into a `{ status, body }` pair; the entry script maps that
 * onto a Node `http` response.
 *
 * The handlers return `{ records }` — neutral English display records, no audit
 * `meta`. The live dashboard is a view, not an artifact; provenance belongs to the
 * snapshot file that `generate-snapshot.ts` writes.
 */
import {
  PersonioApiError,
  resolveSourceKind,
  type PersonioClient,
  type SourceKind,
} from '../../src/index.js';
import {
  buildAttendanceDisplayRecords,
  buildAbsenceDisplayRecords,
  type BuildAttendanceRecordsOptions,
  type BuildAbsenceRecordsOptions,
} from './displayRecordsBuilder.js';
import type {
  AttendanceDisplayRecord,
  AbsenceDisplayRecord,
} from './model/displayRecords.js';

/**
 * Account-scoped values resolved once at startup and reused for every request
 * (the CLI has no per-request account config — only `from`/`to`/`source` vary).
 */
export interface DashboardHandlerContext {
  /** Attendance Custom Report id; used only by the attendance endpoint. */
  attendanceReportId?: string | null;
  /** Absence Custom Report id; used only by the absences endpoint. */
  absenceReportId?: string | null;
  personnelFieldIds?: string[];
  costCenters?: string[];
  /** Client built once at startup and shared across requests (token cache reuse). */
  client?: PersonioClient;
}

export interface DashboardRequestResult {
  status: number;
  body: unknown;
}

/** The attendance records builder — the real one in production, a stub in tests. */
export type AttendanceRecordsBuilder = (
  options: BuildAttendanceRecordsOptions
) => Promise<AttendanceDisplayRecord[]>;

/** The absence records builder — the real one in production, a stub in tests. */
export type AbsenceRecordsBuilder = (
  options: BuildAbsenceRecordsOptions
) => Promise<AbsenceDisplayRecord[]>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A validated range + resolved source, or a client-error message. */
type RangeResolution =
  | { from: string; to: string; source: SourceKind }
  | { error: string };

/**
 * Validate `from`/`to`/`source` and resolve the effective source (report when
 * `reportId` — the *record-type-specific* report id — is configured and no
 * explicit source is given, else api). Shared by the attendance and absences
 * handlers, each passing its own report id so their contract stays identical.
 */
function resolveRange(query: URLSearchParams, reportId?: string | null): RangeResolution {
  const from = query.get('from');
  const to = query.get('to');
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return { error: "Query parameters 'from' and 'to' are required and must be YYYY-MM-DD." };
  }
  const sourceParam = query.get('source');
  if (sourceParam && sourceParam !== 'api' && sourceParam !== 'report') {
    return { error: `Invalid source '${sourceParam}'. Use 'api' or 'report'.` };
  }
  const source: SourceKind = resolveSourceKind({
    kind: (sourceParam as SourceKind | null) ?? undefined,
    report: reportId ? { reportId } : undefined,
  });
  return { from, to, source };
}

/**
 * Handle a `GET /api/attendance` request. Validates `from`/`to`/`source`, resolves
 * the effective source (defaulting to `report` when a reportId is configured, else
 * `api`, matching {@link resolveSourceKind}), then fetches the records. Any failure
 * is turned into a JSON error body with an appropriate status — the library's
 * scope-aware hint (src/errors.ts) is preserved in the message rather than
 * collapsed into a generic 500.
 *
 * `deps.build` and `deps.onSuccess` are injectable so tests can drive it without
 * touching Personio.
 */
export async function handleAttendanceRequest(
  query: URLSearchParams,
  context: DashboardHandlerContext,
  deps: {
    build?: AttendanceRecordsBuilder;
    onSuccess?: (
      records: AttendanceDisplayRecord[],
      info: { source: SourceKind }
    ) => void | Promise<void>;
  } = {}
): Promise<DashboardRequestResult> {
  const build = deps.build ?? buildAttendanceDisplayRecords;

  const resolved = resolveRange(query, context.attendanceReportId);
  if ('error' in resolved) return { status: 400, body: { error: resolved.error } };

  try {
    const records = await build({
      from: resolved.from,
      to: resolved.to,
      source: resolved.source,
      costCenters: context.costCenters,
      reportId: context.attendanceReportId,
      personnelFieldIds: context.personnelFieldIds,
      client: context.client,
    });
    if (deps.onSuccess) await deps.onSuccess(records, { source: resolved.source });
    return { status: 200, body: { records } };
  } catch (error) {
    return toErrorResult(error);
  }
}

/**
 * Handle a `GET /api/absences` request. Same request contract and error mapping as
 * {@link handleAttendanceRequest} (via the shared {@link resolveRange}), but
 * fetches absences. Kept a separate endpoint so a credential that may read
 * attendance but not absences fails only this call — the example dashboard shows
 * each source's scope-aware error independently.
 */
export async function handleAbsencesRequest(
  query: URLSearchParams,
  context: DashboardHandlerContext,
  deps: {
    build?: AbsenceRecordsBuilder;
    onSuccess?: (
      records: AbsenceDisplayRecord[],
      info: { source: SourceKind }
    ) => void | Promise<void>;
  } = {}
): Promise<DashboardRequestResult> {
  const build = deps.build ?? buildAbsenceDisplayRecords;

  const resolved = resolveRange(query, context.absenceReportId);
  if ('error' in resolved) return { status: 400, body: { error: resolved.error } };

  try {
    const records = await build({
      from: resolved.from,
      to: resolved.to,
      source: resolved.source,
      reportId: context.absenceReportId,
      personnelFieldIds: context.personnelFieldIds,
      client: context.client,
    });
    if (deps.onSuccess) await deps.onSuccess(records, { source: resolved.source });
    return { status: 200, body: { records } };
  } catch (error) {
    return toErrorResult(error);
  }
}

/**
 * Map a thrown error to a JSON error result. A {@link PersonioApiError} forwards
 * its upstream HTTP status (when a real 4xx/5xx) so a credential problem shows as
 * 401, a missing report as 400, etc.; its message already carries the scope-aware
 * hint. Anything else is a 500 with just the message — never a raw stack trace.
 */
function toErrorResult(error: unknown): DashboardRequestResult {
  if (error instanceof PersonioApiError) {
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    return {
      status,
      body: { error: error.message, status: error.status ?? null, path: error.path ?? null },
    };
  }
  return {
    status: 500,
    body: { error: error instanceof Error ? error.message : String(error) },
  };
}
