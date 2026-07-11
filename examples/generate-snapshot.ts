/**
 * Example: generate a dashboard snapshot (array of dashboard records) and,
 * optionally, inject it into an HTML dashboard that reads `__PRELOADED_DATA__`
 * on startup. No account-specific values are hardcoded — cost centers and the
 * HTML path are passed as arguments.
 *
 *   tsx examples/generate-snapshot.ts --from 2026-06-01 --to 2026-06-30 \
 *     --cost-centers 1001,1002,1003 --source api \
 *     --out snapshot.json --inject-html ./dashboard.html
 *
 * Flags:
 *   --from <YYYY-MM-DD>        range start (required)
 *   --to   <YYYY-MM-DD>        range end (required)
 *   --cost-centers <list>      optional comma-separated cost-center pre-filter
 *                              (overrides costCenters from the config file)
 *   --source api|report        data source (default: report if a reportId is set)
 *   --report-id <uuid>         Custom Report to read (report source); overrides the
 *                              config file's reportId / PERSONIO_REPORT_ID per run
 *   --out <file>               snapshot JSON output path (default: snapshot.json)
 *   --inject-html <path>       optional dashboard HTML to inject the snapshot into
 *   --config <path>            optional JSON file with non-secret account config
 *                              (reportId, personnelFieldIds, costCenters); see
 *                              personio.config.example.json. Values also fall
 *                              back to PERSONIO_* env vars.
 *
 * The snapshot file carries an audit-trail header (period, source, report id,
 * timestamp). Credentials come from .env; no secrets are written to the output.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  AttendanceService,
  PersonioClient,
  configFromEnv,
  createSource,
  resolveSourceKind,
  type DateRange,
  type SourceKind,
} from '../src/index.js';
import { parseArgs, parseList, requireString } from './lib/args.js';
import { loadExampleConfig } from './lib/config.js';
import { toDashboardRecord } from './lib/dashboard.js';
import { injectSnapshot, type Snapshot } from './lib/inject.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const range: DateRange = { from: requireString(args, 'from'), to: requireString(args, 'to') };
  const outPath = typeof args.out === 'string' ? args.out : 'snapshot.json';

  // Non-secret account config: --config file > PERSONIO_* env > defaults. A
  // `--cost-centers` flag, being per-run, overrides the config file's default.
  const cfg = loadExampleConfig({ configPath: args.config });
  // reportId is account-scoped but chosen per run, so --report-id overrides the
  // config/env default (same pattern as --cost-centers below).
  const reportId =
    (typeof args['report-id'] === 'string' ? args['report-id'] : undefined) ?? cfg.reportId ?? null;
  const cliCostCenters = parseList(args['cost-centers']);
  const costCenters = cliCostCenters.length ? cliCostCenters : cfg.costCenters;
  const fields = cfg.personnelFieldIds
    ? { personnelNumberFields: cfg.personnelFieldIds }
    : undefined;

  const sourceArg = args.source;
  const kind: SourceKind = resolveSourceKind({
    kind: typeof sourceArg === 'string' ? (sourceArg as SourceKind) : undefined,
    report: reportId ? { reportId } : undefined,
  });

  const client = new PersonioClient(configFromEnv());
  const source = createSource(client, {
    kind,
    // Resolve the account's opaque personnel-number custom field by id (from the
    // config file or PERSONIO_PERSONNEL_FIELD_IDS); else the library defaults.
    api: { fields },
    report: reportId ? { reportId, filterByRange: true } : undefined,
  });

  const records = await new AttendanceService(source).getRecords({
    ...range,
    costCenters: costCenters?.length ? costCenters : undefined,
  });
  const data = records.map(toDashboardRecord);

  const snapshot: Snapshot = {
    meta: {
      from: range.from,
      to: range.to,
      source: kind,
      // Only meaningful when the data actually came from a report; a leftover
      // PERSONIO_REPORT_ID env var must not end up in an api-source audit trail.
      reportId: kind === 'report' ? reportId : null,
      generatedAt: new Date().toISOString(),
      count: data.length,
    },
    data,
  };

  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${data.length} dashboard records → ${outPath} (source: ${kind})`);

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
