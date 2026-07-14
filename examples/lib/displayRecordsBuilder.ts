/**
 * Shared record-building pipeline for the dashboard examples: turn a date range +
 * source selection into an array of neutral, English-keyed display records. Used
 * by both `serve-dashboard.ts` (serves them live over HTTP) and
 * `generate-snapshot.ts` (localizes + writes them), so the two cannot drift.
 *
 * Deliberately *no* audit `meta` here — that provenance block belongs only to the
 * persisted snapshot artifact and is attached by `model/snapshotData.ts`.
 * The live dashboard just renders records, exactly like `export-xlsx.ts` maps
 * service records straight to sheet rows.
 *
 * Nothing account-specific is baked in: the report id, personnel-number field
 * ids, and cost-center pre-filter are all passed in by the caller (resolved from
 * `--config` / `PERSONIO_*` / CLI flags in the examples).
 */
import {
  AttendanceService,
  AbsenceService,
  PersonioClient,
  configFromEnv,
  createSource,
  type ResolvedClientConfig,
  type SourceKind,
} from '../../src/index.js';
import {
  toAttendanceDisplayRecord,
  toAbsenceDisplayRecord,
  type AttendanceDisplayRecord,
  type AbsenceDisplayRecord,
} from './model/displayRecords.js';

export interface BuildAttendanceRecordsOptions {
  /** Range start `YYYY-MM-DD`. */
  from: string;
  /** Range end `YYYY-MM-DD`. */
  to: string;
  /**
   * Resolved data source. Callers that want the "report if a reportId is set,
   * else api" default should resolve it with {@link resolveSourceKind} first and
   * pass the result here — this function does not re-derive it.
   */
  source: SourceKind;
  /** Optional cost-center pre-filter (per-run; account values, never hardcoded). */
  costCenters?: string[];
  /** Custom Report id, required when `source` is `report`; ignored for `api`. */
  reportId?: string | null;
  /** The account's opaque personnel-number custom-field id(s); first match wins. */
  personnelFieldIds?: string[];
  /**
   * A pre-built client to reuse across calls (the server builds one at startup
   * and passes it on every request). When omitted, one is constructed from
   * `clientConfig`, falling back to the environment via {@link configFromEnv}.
   */
  client?: PersonioClient;
  /** Client config used only when `client` is omitted. */
  clientConfig?: ResolvedClientConfig;
}

/** Attendance options minus the attendance-only cost-center pre-filter. */
export type BuildAbsenceRecordsOptions = Omit<BuildAttendanceRecordsOptions, 'costCenters'>;

/**
 * Fetch attendance for the range from the selected source and map it to the
 * neutral {@link AttendanceDisplayRecord} the example dashboard renders. Pure
 * extraction of the pipeline that previously lived inline in `generate-snapshot.ts`.
 */
export async function buildAttendanceDisplayRecords(
  options: BuildAttendanceRecordsOptions
): Promise<AttendanceDisplayRecord[]> {
  const { from, to, source, costCenters, reportId, personnelFieldIds } = options;
  const client = options.client ?? new PersonioClient(options.clientConfig ?? configFromEnv());

  // Resolve the account's opaque personnel-number custom field by id when
  // supplied; otherwise the library falls back to its defaults.
  const fields = personnelFieldIds?.length
    ? { personnelNumberFields: personnelFieldIds }
    : undefined;

  const dataSource = createSource(client, {
    kind: source,
    api: { fields },
    report: reportId ? { reportId, filterByRange: true } : undefined,
  });

  const attendance = await new AttendanceService(dataSource).getRecords({
    from,
    to,
    costCenters: costCenters?.length ? costCenters : undefined,
  });
  return attendance.map(toAttendanceDisplayRecord);
}

/**
 * Fetch absences for the range from the selected source and map them to the
 * neutral {@link AbsenceDisplayRecord}. Enables the ApiSource's opt-in per-period
 * breakdown so `days` is populated (an N+1; see `fetchAbsenceBreakdowns`). The
 * ReportSource fills the amount from the report instead when a `reportId` is set.
 */
export async function buildAbsenceDisplayRecords(
  options: BuildAbsenceRecordsOptions
): Promise<AbsenceDisplayRecord[]> {
  const { from, to, source, reportId, personnelFieldIds } = options;
  const client = options.client ?? new PersonioClient(options.clientConfig ?? configFromEnv());

  const fields = personnelFieldIds?.length
    ? { personnelNumberFields: personnelFieldIds }
    : undefined;

  const dataSource = createSource(client, {
    kind: source,
    api: { fields, fetchAbsenceBreakdowns: true },
    report: reportId ? { reportId, filterByRange: true } : undefined,
  });

  const absences = await new AbsenceService(dataSource).getRecords({ from, to });
  return absences.map(toAbsenceDisplayRecord);
}
