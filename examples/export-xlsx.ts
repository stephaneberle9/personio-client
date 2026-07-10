/**
 * Example: export attendance and/or absence data to Excel files that reproduce
 * the reference report format exactly (sheet names, header order, exact labels).
 *
 *   tsx examples/export-xlsx.ts --from 2026-06-01 --to 2026-06-30 \
 *     --type both --source api --out ./out
 *
 * Flags:
 *   --from <YYYY-MM-DD>      range start (required)
 *   --to   <YYYY-MM-DD>      range end (required)
 *   --type attendance|absence|both   what to export (default: both)
 *   --source api|report      data source (default: report if PERSONIO_REPORT_ID set, else api)
 *   --out <dir>              output directory (default: .)
 *   --absence-breakdowns <true|false>   api source only: fetch per-period
 *                           breakdowns so the absence amount columns are
 *                           populated (default: true, needed for report parity;
 *                           an opt-in N+1, pass `false` to skip it)
 *
 * Credentials come from .env (PERSONIO_CLIENT_ID / PERSONIO_CLIENT_SECRET).
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AbsenceService,
  AttendanceService,
  PersonioClient,
  configFromEnv,
  createSource,
  resolveSourceKind,
  type DateRange,
  type SourceKind,
} from '../src/index.js';
import { parseArgs, requireString } from './lib/args.js';
import {
  ABSENCE_HEADERS,
  ABSENCE_SHEET_NAME,
  ATTENDANCE_HEADERS,
  ATTENDANCE_SHEET_NAME,
  absenceRow,
  attendanceRow,
} from './lib/columns.js';
import { buildSheetWorkbook, writeWorkbook } from './lib/xlsx.js';

type ExportType = 'attendance' | 'absence' | 'both';

/**
 * German localization for the raw v2 status enums, matching the labels the
 * legacy Custom Report Excel export shows in the "Status des
 * Abwesenheitszeitraums" column. This is an output format, not library logic —
 * it lives in the example and is passed to both sources via `statusLabels` so
 * the export reaches 1:1 parity with the reference report regardless of source
 * (the API source carries raw enums, the Reporting-v2 read carries English
 * labels — both normalize to the same key). Values without an entry pass
 * through unchanged.
 */
const STATUS_LABELS_DE: Record<string, string> = {
  APPROVED: 'Genehmigt',
  PENDING: 'Ausstehend',
  REJECTED: 'Abgelehnt',
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const range: DateRange = { from: requireString(args, 'from'), to: requireString(args, 'to') };
  const type = (args.type ?? 'both') as ExportType;
  const outDir = typeof args.out === 'string' ? args.out : '.';
  const reportId = process.env.PERSONIO_REPORT_ID;

  const sourceArg = args.source;
  const kind: SourceKind = resolveSourceKind({
    kind: typeof sourceArg === 'string' ? (sourceArg as SourceKind) : undefined,
    report: reportId ? { reportId } : undefined,
  });

  // Populate the absence amount columns from per-period breakdowns by default so
  // the API export matches the reference report (otherwise the parity check in
  // step 2 flags the empty quantity columns as a difference). Opt out with
  // `--absence-breakdowns false` to skip the extra per-period calls.
  const fetchAbsenceBreakdowns = args['absence-breakdowns'] !== 'false';

  const client = new PersonioClient(configFromEnv());
  const source = createSource(client, {
    kind,
    api: {
      // Localize the raw v2 status enums to the German report labels so the
      // API-sourced export matches the reference report.
      statusLabels: STATUS_LABELS_DE,
      fetchAbsenceBreakdowns,
    },
    // The Reporting-v2 read returns English option labels ("Approved") for the
    // absence status, so localize it the same way — one map serves both sources
    // (normalized to the enum key before lookup).
    report: reportId
      ? { reportId, filterByRange: true, statusLabels: STATUS_LABELS_DE }
      : undefined,
  });

  mkdirSync(outDir, { recursive: true });

  if (type === 'attendance' || type === 'both') {
    const records = await new AttendanceService(source).getRecords(range);
    const rows = records.map((r) => attendanceRow(r, range));
    const workbook = buildSheetWorkbook(ATTENDANCE_SHEET_NAME, ATTENDANCE_HEADERS, rows);
    const path = join(outDir, `attendance_${range.from}_${range.to}.xlsx`);
    writeWorkbook(workbook, path);
    console.log(`Wrote ${records.length} attendance rows → ${path} (source: ${kind})`);
  }

  if (type === 'absence' || type === 'both') {
    const records = await new AbsenceService(source).getRecords(range);
    const rows = records.map((r) => absenceRow(r, range));
    const workbook = buildSheetWorkbook(ABSENCE_SHEET_NAME, ABSENCE_HEADERS, rows);
    const path = join(outDir, `absence_${range.from}_${range.to}.xlsx`);
    writeWorkbook(workbook, path);
    console.log(`Wrote ${records.length} absence rows → ${path} (source: ${kind})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
