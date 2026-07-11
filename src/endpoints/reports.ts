import { HttpClient } from '../http/client.js';

/** A resolved report column: opaque id plus its human-readable label. */
export interface ReportColumn {
  /** Column id as returned by Personio (the report attribute name, e.g. `attendance_hours_tracked`, or a `dynamic_<id>` custom field). */
  id: string;
  /** Human-readable label from the report's own column metadata. */
  label: string;
  /** Personio's declared cell type for this column (e.g. `string`, `decimal`, `option`), when available. */
  type?: string;
}

/** Normalized Custom Report payload: labelled columns plus row objects. */
export interface ReportData {
  columns: ReportColumn[];
  /** One object per row, keyed by column id, with cell values unwrapped to plain scalars. */
  rows: Array<Record<string, unknown>>;
}

export interface ReportsEndpointOptions {
  /**
   * Build the report read path from a report id. Defaults to the Reporting v2
   * path, confirmed against a live account.
   */
  reportPath?: (reportId: string) => string;
}

const DEFAULT_REPORT_PATH = (id: string): string =>
  `/v2/reports/${encodeURIComponent(id)}`;

/**
 * Read a Personio report by id and normalize it to {@link ReportData}.
 *
 * Uses the **Reporting v2** API (the v1 Custom Reports API is intentionally not
 * used — this is a v2-only client). Confirmed live (2026-07-09):
 * `GET /v2/reports/{id}` returns
 * `{ report_config, _data, _meta: { columns } }`, where `_meta.columns` is
 * `[{ name, display, type }]` and `_data` is an array of rows, each row a
 * positional array of typed cell objects aligned to `_meta.columns`. Only
 * Custom Reports explicitly **shared with the API credential** in Personio
 * (Reports → the report → Share) appear here — granting the credential's
 * `reports:read` right alone is not sufficient. Some report configurations
 * (seen on grouped/chart-visualization reports in this account) reject the
 * read with `400 "Unsupported nested type: null"`; only flat table reports
 * are readable this way.
 */
export class ReportsEndpoint {
  private readonly reportPath: (reportId: string) => string;

  constructor(private readonly http: HttpClient, options: ReportsEndpointOptions = {}) {
    this.reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;
  }

  async get(reportId: string): Promise<ReportData> {
    const body = await this.http.get<any>(this.reportPath(reportId));
    return normalizeReport(body);
  }
}

/** Normalize a Reporting v2 `GET /v2/reports/{id}` payload into {@link ReportData}. */
export function normalizeReport(body: any): ReportData {
  const metaColumns: any[] = body?._meta?.columns ?? [];
  const columns: ReportColumn[] = metaColumns.map((c) => ({
    id: String(c?.name ?? c?.id ?? ''),
    label: String(c?.display ?? c?.name ?? ''),
    type: typeof c?.type === 'string' ? c.type : undefined,
  }));

  const rawRows: any[] = Array.isArray(body?._data) ? body._data : [];
  const rows: Array<Record<string, unknown>> = rawRows.map((row) => {
    const obj: Record<string, unknown> = {};
    if (Array.isArray(row)) {
      row.forEach((cell, i) => {
        const columnId = columns[i]?.id ?? String(i);
        obj[columnId] = unwrapCellValue(cell);
      });
    }
    return obj;
  });

  return { columns, rows };
}

/**
 * Unwrap a Reporting v2 cell (`{ attribute_id, <type>_value }`) to a plain
 * scalar. `numeric_value`, `string_value` and `options_value` are confirmed
 * live; `percentage_value` / `monetary_value` are not present in any report
 * shared with the verified account and are handled best-effort — VERIFY if
 * your report uses those column types.
 */
function unwrapCellValue(cell: any): unknown {
  if (cell === null || cell === undefined || typeof cell !== 'object') return cell ?? null;
  if (cell.numeric_value) return cell.numeric_value.number ?? null;
  if (cell.string_value) return cell.string_value.value ?? '';
  if (cell.options_value) {
    const options: any[] = cell.options_value.options ?? [];
    return options.map((o) => o?.value ?? o?.key ?? '').join(', ');
  }
  if (cell.time_range_value) {
    const { from, to } = cell.time_range_value ?? {};
    return from && to ? `${from} – ${to}` : (from ?? to ?? '');
  }
  if (cell.percentage_value) return cell.percentage_value.number ?? cell.percentage_value.value ?? null;
  if (cell.monetary_value) return cell.monetary_value.amount ?? cell.monetary_value.value ?? null;
  return null;
}
