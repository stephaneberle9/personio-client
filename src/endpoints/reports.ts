import { HttpClient } from '../http/client.js';

/** A resolved report column: opaque id plus its human-readable label. */
export interface ReportColumn {
  /** Column id as returned by Personio (may be a `dynamic_<id>` key). */
  id: string;
  /** Human-readable label, resolved from the report metadata where available. */
  label: string;
}

/** Normalized Custom Report payload: labelled columns plus row objects. */
export interface ReportData {
  columns: ReportColumn[];
  /** One object per row, keyed by column id. */
  rows: Array<Record<string, unknown>>;
}

export interface ReportsEndpointOptions {
  /**
   * Build the report read path from a report id. Defaults to the Reporting v2
   * path. The exact v2 reporting path/payload depends on the account and is not
   * fully documented — override this without a code change once verified.
   */
  reportPath?: (reportId: string) => string;
}

/** Default Reporting v2 read path. VERIFY against a real account. */
const DEFAULT_REPORT_PATH = (id: string): string =>
  `/v2/reports/${encodeURIComponent(id)}`;

/**
 * Read a Personio report by id and normalize it to {@link ReportData}.
 *
 * Uses the **Reporting v2** API (the v1 Custom Reports API is intentionally not
 * used — this is a v2-only client). The exact v2 path and payload shape depend
 * on the account and are flagged for verification (see OPEN_QUESTIONS.md); the
 * path is overridable via {@link ReportsEndpointOptions.reportPath}. The
 * normalizer tolerates the common column/row payload variants and resolves
 * `dynamic_<id>` column ids to labels from the report's own column metadata.
 */
export class ReportsEndpoint {
  private readonly reportPath: (reportId: string) => string;

  constructor(private readonly http: HttpClient, options: ReportsEndpointOptions = {}) {
    this.reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;
  }

  async get(reportId: string): Promise<ReportData> {
    // VERIFY: exact Reporting v2 path/shape against a real account.
    const body = await this.http.get<any>(this.reportPath(reportId));
    return normalizeReport(body);
  }
}

/** Collapse the various Custom Report payload shapes into {@link ReportData}. */
export function normalizeReport(body: any): ReportData {
  const data = body?.data ?? body?._data ?? body ?? {};

  const rawColumns: any[] = data.columns ?? data.headers ?? [];
  const columns: ReportColumn[] = rawColumns.map((c) => {
    if (typeof c === 'string') return { id: c, label: c };
    const id = String(c.id ?? c.key ?? c.slug ?? '');
    const label = String(c.label ?? c.name ?? c.title ?? id);
    return { id, label };
  });

  const rawRows: any[] = data.rows ?? data.records ?? [];
  const rows: Array<Record<string, unknown>> = rawRows.map((row) => {
    // Rows may be objects keyed by column id, or positional arrays aligned to columns.
    if (Array.isArray(row)) {
      const obj: Record<string, unknown> = {};
      row.forEach((value, i) => {
        const key = columns[i]?.id ?? String(i);
        obj[key] = value;
      });
      return obj;
    }
    return row as Record<string, unknown>;
  });

  return { columns, rows };
}
