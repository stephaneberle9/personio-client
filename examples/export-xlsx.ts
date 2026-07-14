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
 *   --source api|report      data source (default per type: report if that type's
 *                           report id is set, else api)
 *   --attendance-report-id <uuid>   attendance Custom Report (report source);
 *                           overrides attendanceReportId / PERSONIO_ATTENDANCE_REPORT_ID
 *   --absence-report-id <uuid>      absence Custom Report (report source);
 *                           overrides absenceReportId / PERSONIO_ABSENCE_REPORT_ID
 *   --out <dir>              output directory (default: .)
 *   --absence-breakdowns <true|false>   api source only: fetch per-period
 *                           breakdowns so the absence amount columns are
 *                           populated (default: true, needed for report parity;
 *                           an opt-in N+1, pass `false` to skip it)
 *   --config <path>          optional JSON file with non-secret account/locale
 *                           config (attendanceReportId, absenceReportId,
 *                           personnelFieldIds, statusLabels); see
 *                           personio.config.example.json. Individual values also
 *                           fall back to PERSONIO_* env vars.
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
import { loadExampleConfig } from './lib/config.js';
import {
  ABSENCE_HEADERS,
  ABSENCE_SHEET_NAME,
  ATTENDANCE_HEADERS,
  ATTENDANCE_SHEET_NAME,
  absenceRow,
  attendanceRow,
} from './lib/model/sheetContent.js';
import { buildSheetWorkbook, writeWorkbook } from './lib/xlsxBuilder.js';

type ExportType = 'attendance' | 'absence' | 'both';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const range: DateRange = { from: requireString(args, 'from'), to: requireString(args, 'to') };
  const type = (args.type ?? 'both') as ExportType;
  const outDir = typeof args.out === 'string' ? args.out : '.';

  // Non-secret account/locale config: --config file > PERSONIO_* env > defaults.
  const cfg = loadExampleConfig({ configPath: args.config });
  // Attendance and absences live in different Custom Reports, so each type resolves
  // its source from its own report id; --attendance-report-id / --absence-report-id
  // override the config/env default per run.
  const attendanceReportId =
    (typeof args['attendance-report-id'] === 'string' ? args['attendance-report-id'] : undefined) ??
    cfg.attendanceReportId;
  const absenceReportId =
    (typeof args['absence-report-id'] === 'string' ? args['absence-report-id'] : undefined) ??
    cfg.absenceReportId;
  const fields = cfg.personnelFieldIds
    ? { personnelNumberFields: cfg.personnelFieldIds }
    : undefined;

  const sourceArg = args.source;
  // Populate the absence amount columns from per-period breakdowns by default so
  // the API export matches the reference report (otherwise the parity check in
  // step 2 flags the empty quantity columns as a difference). Opt out with
  // `--absence-breakdowns false` to skip the extra per-period calls.
  const fetchAbsenceBreakdowns = args['absence-breakdowns'] !== 'false';

  const client = new PersonioClient(configFromEnv());

  // Build a data source for one record type from its own report id (unset → the
  // granular v2 API). Returns the resolved kind too, for the per-file log line.
  const sourceFor = (reportId: string | undefined) => {
    const kind: SourceKind = resolveSourceKind({
      kind: typeof sourceArg === 'string' ? (sourceArg as SourceKind) : undefined,
      report: reportId ? { reportId } : undefined,
    });
    const source = createSource(client, {
      kind,
      api: {
        // Localize the raw v2 status enums to the configured report labels so the
        // API-sourced export matches the reference report.
        statusLabels: cfg.statusLabels,
        fetchAbsenceBreakdowns,
        // Resolve the account's opaque personnel-number custom field by id (from
        // the config file or PERSONIO_PERSONNEL_FIELD_IDS); else library defaults.
        fields,
      },
      // The Reporting-v2 read returns English option labels ("Approved") for the
      // absence status, so localize it the same way — one map serves both sources
      // (normalized to the enum key before lookup).
      report: reportId
        ? { reportId, filterByRange: true, statusLabels: cfg.statusLabels }
        : undefined,
    });
    return { source, kind };
  };

  mkdirSync(outDir, { recursive: true });

  if (type === 'attendance' || type === 'both') {
    const { source, kind } = sourceFor(attendanceReportId);
    const records = await new AttendanceService(source).getRecords(range);
    const rows = records.map((r) => attendanceRow(r, range));
    const workbook = buildSheetWorkbook(ATTENDANCE_SHEET_NAME, ATTENDANCE_HEADERS, rows);
    const path = join(outDir, `attendance_${range.from}_${range.to}.xlsx`);
    writeWorkbook(workbook, path);
    console.log(`Wrote ${records.length} attendance rows → ${path} (source: ${kind})`);
  }

  if (type === 'absence' || type === 'both') {
    const { source, kind } = sourceFor(absenceReportId);
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
