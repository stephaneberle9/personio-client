/**
 * Diagnose why a report-sourced pull returns few/no rows. Runs the ReportSource
 * end-to-end (exactly as the examples do) and prints — with **no personal data**,
 * only counts and dates — how many records it produced, how many had an
 * unresolved (empty) date, the date span, a per-month histogram, and how many
 * fall inside the requested range. Distinguishes a column-resolution bug (all
 * dates empty) from a wrong-shaped/grouped report (dates resolve but none land in
 * range) from a filter bug (in-range > 0 but the filtered pull is 0).
 *
 * Usage (from the repo root):
 *
 *   npx tsx scripts/inspect-report.ts <report-id> <from> <to> [attendance|absence]
 *
 * Credentials come from .env via dotenv (DOTENV_CONFIG_PATH is honored).
 */
import 'dotenv/config';
import {
  PersonioClient,
  configFromEnv,
  createSource,
  AttendanceService,
  AbsenceService,
} from '../src/index.js';

const [, , reportId, from = '2026-06-01', to = '2026-06-30', kind = 'attendance'] = process.argv;
if (!reportId) {
  console.error('Usage: tsx scripts/inspect-report.ts <report-id> <from> <to> [attendance|absence]');
  process.exit(2);
}

async function dates(client: PersonioClient, filterByRange: boolean): Promise<string[]> {
  const source = createSource(client, { kind: 'report', report: { reportId, filterByRange } });
  if (kind === 'absence') {
    const recs = await new AbsenceService(source).getRecords({ from, to });
    return recs.map((r) => r.startDate ?? '');
  }
  const recs = await new AttendanceService(source).getRecords({ from, to });
  return recs.map((r) => r.date);
}

async function main(): Promise<void> {
  const client = new PersonioClient(configFromEnv());

  const all = await dates(client, false);
  const nonEmpty = all.filter(Boolean).sort();
  const hist: Record<string, number> = {};
  for (const d of all) {
    const key = d ? d.slice(0, 7) : '(empty)';
    hist[key] = (hist[key] ?? 0) + 1;
  }

  console.log(`report ${reportId} — ${kind}, range ${from}..${to}\n`);
  console.log(`unfiltered records:     ${all.length}`);
  console.log(`  with empty date:      ${all.filter((d) => !d).length}`);
  console.log(`  date span:            ${nonEmpty[0] ?? '-'} .. ${nonEmpty[nonEmpty.length - 1] ?? '-'}`);
  console.log(`  by month:             ${JSON.stringify(hist)}`);
  console.log(`  within ${from}..${to}: ${all.filter((d) => d && d >= from && d <= to).length}`);

  const filtered = await dates(client, true);
  console.log(`\nfiltered pull (filterByRange=true): ${filtered.length}`);

  console.log(
    '\nRead:\n' +
      '  all dates empty        -> column resolution / cell unwrap bug\n' +
      '  dates resolve, in-range 0 -> report is grouped/wrong-shaped (use a flat table report)\n' +
      '  in-range > 0 but filtered 0 -> range-filter bug',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
