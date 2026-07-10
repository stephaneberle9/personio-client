/**
 * Peek into a Custom Report via `GET /v2/reports/{id}`: print its columns,
 * row count, the first rows, and the min/max of every date-like column.
 * Useful to see the report's own configured timeframe before wondering why a
 * range-filtered export came back empty.
 *
 * Usage (from the repo root):
 *
 *   npx tsx scripts/peek-report.ts <report-id> [maxRows]
 *
 * Credentials come from .env via dotenv (DOTENV_CONFIG_PATH is honored).
 */
import 'dotenv/config';
import { PersonioClient, configFromEnv } from '../src/index.js';

const [, , reportId, maxRowsArg] = process.argv;
if (!reportId) {
  console.error('Usage: tsx scripts/peek-report.ts <report-id> [maxRows]');
  process.exit(2);
}
const maxRows = Number(maxRowsArg ?? 3);

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

async function main(): Promise<void> {
  const client = new PersonioClient(configFromEnv());
  const report = await client.reports.get(reportId);

  console.log(`columns (${report.columns.length}):`);
  for (const c of report.columns) {
    console.log(`  ${c.id}  [${c.type ?? '?'}]  "${c.label}"`);
  }

  console.log(`\nrows: ${report.rows.length}`);

  // Min/max per date-like column, to reveal the report's own timeframe.
  for (const c of report.columns) {
    const values = report.rows
      .map((r) => r[c.id])
      .filter((v): v is string => typeof v === 'string' && DATE_RE.test(v))
      .sort();
    if (values.length > 0) {
      console.log(`  ${c.id}: ${values[0]} .. ${values[values.length - 1]} (${values.length} date value(s))`);
    }
  }

  if (report.rows.length > 0) {
    console.log(`\nfirst ${Math.min(maxRows, report.rows.length)} row(s):`);
    for (const row of report.rows.slice(0, maxRows)) {
      console.log(JSON.stringify(row));
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
