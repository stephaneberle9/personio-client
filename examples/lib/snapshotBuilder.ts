/**
 * Shared snapshot-building pipeline used by both `generate-snapshot.ts` (writes a
 * JSON file) and `serve-dashboard.ts` (serves it on demand over HTTP). It is the
 * single place that turns a date range + source selection into the dashboard
 * record array plus the audit `meta` block, so the two examples cannot drift.
 *
 * Nothing account-specific is baked in: the report id, personnel-number field
 * ids, and cost-center pre-filter are all passed in by the caller (resolved from
 * `--config` / `PERSONIO_*` / CLI flags in the examples), exactly as before.
 */
import {
  AttendanceService,
  PersonioClient,
  configFromEnv,
  createSource,
  type ResolvedClientConfig,
  type SourceKind,
} from '../../src/index.js';
import { toDashboardRecord, type DashboardRecord } from './model/dashboard.js';

/** Audit-trail metadata recorded alongside a snapshot (concept §12). */
export interface SnapshotMeta {
  from: string;
  to: string;
  source: string;
  reportId: string | null;
  generatedAt: string;
  count: number;
}

/** Dashboard records plus the audit-trail `meta` block — the canonical snapshot. */
export interface Snapshot {
  records: DashboardRecord[];
  meta: SnapshotMeta;
}

export interface BuildSnapshotOptions {
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

/**
 * Fetch attendance for the range from the selected source, map it to dashboard
 * records, and attach the audit `meta` block (period, source, report id when the
 * data really came from a report, timestamp, record count). Pure extraction of
 * the pipeline that previously lived inline in `generate-snapshot.ts` — same
 * output for the same inputs.
 */
export async function buildSnapshot(options: BuildSnapshotOptions): Promise<Snapshot> {
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
  const records = attendance.map(toDashboardRecord);

  const meta: SnapshotMeta = {
    from,
    to,
    source,
    // Only meaningful when the data actually came from a report; a leftover
    // reportId must not end up in an api-source audit trail.
    reportId: source === 'report' ? reportId ?? null : null,
    generatedAt: new Date().toISOString(),
    count: records.length,
  };

  return { records, meta };
}
