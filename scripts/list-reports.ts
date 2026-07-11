/**
 * List the Custom Reports visible to the API credential via `GET /v2/reports`.
 *
 * Only reports explicitly shared with the credential in Personio appear here
 * (Reports -> open the report -> Share -> select the credential); the
 * credential's reports:read right alone yields an empty list. Only flat
 * `table` reports can be read via `GET /v2/reports/{id}`; grouped/chart
 * reports reject the read.
 *
 * Usage (from the repo root):
 *
 *   npx tsx scripts/list-reports.ts
 *
 * Credentials come from .env via dotenv (PERSONIO_CLIENT_ID /
 * PERSONIO_CLIENT_SECRET; DOTENV_CONFIG_PATH is honored).
 */
import 'dotenv/config';
import { PersonioClient, configFromEnv } from '../src/index.js';

interface ReportListItem {
  id?: unknown;
  name?: unknown;
  chart_type?: unknown;
  edited_at?: unknown;
}

async function main(): Promise<void> {
  const client = new PersonioClient(configFromEnv());
  const body = await client.http.get<any>('/v2/reports');
  const reports: ReportListItem[] = Array.isArray(body?._data) ? body._data : [];

  if (reports.length === 0) {
    console.log(
      'No reports visible to this credential.\n' +
        'Note: a report must be explicitly shared with the API credential in\n' +
        'Personio (Reports -> open the report -> Share); the reports:read right\n' +
        'alone yields an empty list.',
    );
    return;
  }

  console.log(`${reports.length} report(s) shared with this credential:\n`);
  for (const r of reports) {
    const chartType = String(r.chart_type ?? '');
    // chart_type is NOT a reliable readability indicator: reports built with
    // chart grouping still list as "table" here but reject the read with
    // 400 "Unsupported nested type: null" (observed live). Probe with
    // scripts/peek-report.ts <id> to know for sure.
    const readable = 'readability unknown, probe with peek-report.ts';
    // edited_at is an object wrapper (like other v2 date fields), not a string.
    const rawEdited: any = r.edited_at;
    const edited = String(
      (typeof rawEdited === 'object' && rawEdited !== null
        ? rawEdited.date_time ?? rawEdited.date ?? ''
        : rawEdited) ?? '',
    ).slice(0, 10);
    console.log(`  id: ${String(r.id ?? '?')}`);
    console.log(`      name:       ${String(r.name ?? '')}`);
    console.log(`      chart_type: ${chartType || '?'} (${readable})`);
    if (edited) console.log(`      edited_at:  ${edited}`);
    console.log('');
  }

  // The reports list carries plain-string pagination links (unlike the
  // { href } objects of other endpoints) — surface a second page if present.
  const next = body?._meta?.links?.next;
  if (typeof next === 'string' && next) {
    console.log(`More pages exist (not fetched by this script): ${next}`);
  }

  console.log(
    'Pick a flat table report matching the export type, then:\n' +
      '  $env:PERSONIO_REPORT_ID = "<id>"\n' +
      '  npx tsx examples/export-xlsx.ts --from ... --to ... --type <attendance|absence> --source report --out out/report\n' +
      '(attendance and absence need their own report id, one run each)',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
