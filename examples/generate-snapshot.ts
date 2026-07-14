/**
 * Example: generate a dashboard snapshot (an array of German
 * `SnapshotRecord`s) and, optionally, inject it into a controlling dashboard
 * that reads `__PRELOADED_DATA__` on startup. That target is *your own* external
 * HTML page — NOT the bundled `examples/dashboard.html`, which is the live,
 * server-backed dashboard (English keys, fetches the API, reads no
 * `__PRELOADED_DATA__`). No account-specific values are hardcoded — cost centers
 * and the HTML path are passed as arguments.
 *
 *   tsx examples/generate-snapshot.ts --from 2026-06-01 --to 2026-06-30 \
 *     --cost-centers 1001,1002,1003 --source api \
 *     --out snapshot.json --inject-html ./your-dashboard.html
 *
 * Flags:
 *   --from <YYYY-MM-DD>        range start (required)
 *   --to   <YYYY-MM-DD>        range end (required)
 *   --cost-centers <list>      optional comma-separated cost-center pre-filter
 *                              (overrides costCenters from the config file)
 *   --source api|report        data source (default: report if an attendance
 *                              report id is set, else api)
 *   --attendance-report-id <uuid>  attendance Custom Report to read (report
 *                              source); overrides attendanceReportId /
 *                              PERSONIO_ATTENDANCE_REPORT_ID per run
 *   --out <file>               snapshot JSON output path (default: snapshot.json)
 *   --inject-html <path>       optional: your own `__PRELOADED_DATA__`-reading
 *                              dashboard to inject the snapshot into (not the
 *                              bundled examples/dashboard.html)
 *   --config <path>            optional JSON file with non-secret account config
 *                              (attendanceReportId, personnelFieldIds, costCenters);
 *                              see personio.config.example.json. Values also fall
 *                              back to PERSONIO_* env vars.
 *
 * The snapshot file carries an audit-trail header (period, source, report id,
 * timestamp). Credentials come from .env; no secrets are written to the output.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveSourceKind, type DateRange, type SourceKind } from '../src/index.js';
import { parseArgs, parseList, requireString } from './lib/args.js';
import { buildAttendanceDisplayRecords } from './lib/displayRecordsBuilder.js';
import { loadExampleConfig } from './lib/config.js';
import { toSnapshot } from './lib/model/snapshotData.js';
import { injectSnapshot } from './lib/snapshotInjector.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const range: DateRange = { from: requireString(args, 'from'), to: requireString(args, 'to') };
  const outPath = typeof args.out === 'string' ? args.out : 'snapshot.json';

  // Non-secret account config: --config file > PERSONIO_* env > defaults. A
  // `--cost-centers` flag, being per-run, overrides the config file's default.
  const cfg = loadExampleConfig({ configPath: args.config });
  // This script emits attendance only, so it uses the attendance report id;
  // --attendance-report-id overrides the config/env default per run.
  const reportId =
    (typeof args['attendance-report-id'] === 'string' ? args['attendance-report-id'] : undefined) ??
    cfg.attendanceReportId ??
    null;
  const cliCostCenters = parseList(args['cost-centers']);
  const costCenters = cliCostCenters.length ? cliCostCenters : cfg.costCenters;

  const sourceArg = args.source;
  const kind: SourceKind = resolveSourceKind({
    kind: typeof sourceArg === 'string' ? (sourceArg as SourceKind) : undefined,
    report: reportId ? { reportId } : undefined,
  });

  const records = await buildAttendanceDisplayRecords({
    from: range.from,
    to: range.to,
    source: kind,
    costCenters,
    reportId,
    personnelFieldIds: cfg.personnelFieldIds,
  });

  // The pipeline speaks English display records; the German `SnapshotRecord`
  // shape a `__PRELOADED_DATA__` dashboard expects (plus the audit `meta` block)
  // is produced only here, at the very end of the chain, right before the file
  // write and HTML injection.
  const snapshot = toSnapshot(records, {
    from: range.from,
    to: range.to,
    source: kind,
    reportId,
  });

  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(
    `Wrote ${snapshot.records.length} dashboard records → ${outPath} (source: ${kind})`
  );

  const injectPath = args['inject-html'];
  if (typeof injectPath === 'string') {
    const html = readFileSync(injectPath, 'utf8');
    writeFileSync(injectPath, injectSnapshot(html, snapshot), 'utf8');
    console.log(`Injected snapshot into ${injectPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
