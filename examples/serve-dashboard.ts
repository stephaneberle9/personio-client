/**
 * Example: serve the dashboard data on demand from a small local HTTP server, so a
 * browser page can trigger a live Personio pull by clicking a button instead of
 * running `generate-snapshot.ts` beforehand. Same record-building pipeline
 * ({@link buildAttendanceDisplayRecords}), just exposed as an endpoint.
 *
 *   tsx examples/serve-dashboard.ts --html ./dashboard.html --config personio.config.json
 *
 * Flags:
 *   --html <path>          static HTML file served at `/` (required)
 *   --port <n>             listen port (default: 4173)
 *   --cost-centers <list>  optional comma-separated cost-center pre-filter
 *                          (overrides costCenters from the config file)
 *   --config <path>        optional JSON file with non-secret account config
 *                          (attendanceReportId, absenceReportId, personnelFieldIds,
 *                          costCenters); values also fall back to PERSONIO_* env
 *                          vars. Leave a report id unset to serve that card from
 *                          the granular v2 API instead of a Custom Report.
 *
 * Endpoints:
 *   GET /                                     → the HTML file passed via --html
 *   GET /api/attendance?from=&to=&source=     → live attendance pull, { records }
 *   GET /api/absences?from=&to=&source=       → live absences pull, { records }
 *
 * `examples/dashboard.html` is the ready-made dashboard for both endpoints: two
 * independent cards (Attendance + Absences), each loading and surfacing errors on
 * its own. Pass it via `--html examples/dashboard.html`.
 *
 * This server is deliberately local-only: it binds to 127.0.0.1, serves the one
 * person at the machine, and reads credentials from `.env` that never leave the
 * Node process. Do not add remote binding, auth, or multi-tenant config — that is
 * a different (and explicitly ruled-out) architecture. It is a live view: the
 * audit-trail artifact (with provenance `meta`) is `generate-snapshot.ts`'s job.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { PersonioClient, configFromEnv } from '../src/index.js';
import { parseArgs, parseList, requireString } from './lib/args.js';
import { loadExampleConfig } from './lib/config.js';
import {
  handleAttendanceRequest,
  handleAbsencesRequest,
  type DashboardHandlerContext,
} from './lib/dashboardHandler.js';

/** Local-only by design — never bind a routable interface (e.g. 0.0.0.0). */
const HOST = '127.0.0.1';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2) + '\n');
}

function serveHtml(res: ServerResponse, htmlPath: string): void {
  let html: Buffer;
  try {
    html = readFileSync(htmlPath);
  } catch {
    sendJson(res, 404, { error: `HTML file not found: ${htmlPath}` });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * Open the default browser at `url`, cross-platform, without adding a dependency.
 * Best-effort: failure to open a browser is a convenience miss, not a server
 * error, so it never throws.
 */
function openBrowser(url: string): void {
  const [cmd, cmdArgs] =
    process.platform === 'win32'
      ? (['cmd', ['/c', 'start', '', url]] as const)
      : process.platform === 'darwin'
        ? (['open', [url]] as const)
        : (['xdg-open', [url]] as const);
  try {
    const child = spawn(cmd, [...cmdArgs], { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* no browser / command unavailable — ignore */
    });
    child.unref();
  } catch {
    /* ignore — opening a browser is optional */
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const htmlPath = requireString(args, 'html');
  const port = typeof args.port === 'string' ? Number(args.port) : 4173;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid --port '${String(args.port)}' (expected a positive integer)`);
  }

  // Non-secret account config: --config file > PERSONIO_* env > defaults. A
  // `--cost-centers` flag, being per-run, overrides the config file's default.
  const cfg = loadExampleConfig({ configPath: args.config });
  const cliCostCenters = parseList(args['cost-centers']);
  const costCenters = cliCostCenters.length ? cliCostCenters : cfg.costCenters;

  // Build the client once; every request reuses it (and its in-memory token).
  const client = new PersonioClient(configFromEnv());
  const context: DashboardHandlerContext = {
    // Attendance and absences come from different reports; each endpoint uses its
    // own id (either may be unset → that card falls back to the granular v2 API).
    attendanceReportId: cfg.attendanceReportId ?? null,
    absenceReportId: cfg.absenceReportId ?? null,
    personnelFieldIds: cfg.personnelFieldIds,
    costCenters,
    client,
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}:${port}`);

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: `Method ${req.method} not allowed.` });
      return;
    }

    if (url.pathname === '/') {
      serveHtml(res, htmlPath);
      return;
    }

    if (url.pathname === '/api/attendance') {
      handleAttendanceRequest(url.searchParams, context, {
        onSuccess: (records, { source }) =>
          console.log(`  ↳ ${records.length} attendance records (source: ${source})`),
      })
        .then((result) => sendJson(res, result.status, result.body))
        .catch((error) => {
          // handleAttendanceRequest catches Personio failures itself; reaching here
          // means an unexpected fault. Never let it crash the server or leak a
          // stack trace to the client.
          console.error(error);
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    if (url.pathname === '/api/absences') {
      handleAbsencesRequest(url.searchParams, context, {
        onSuccess: (records, { source }) =>
          console.log(`  ↳ ${records.length} absence records (source: ${source})`),
      })
        .then((result) => sendJson(res, result.status, result.body))
        .catch((error) => {
          console.error(error);
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    sendJson(res, 404, { error: `Not found: ${url.pathname}` });
  });

  server.listen(port, HOST, () => {
    // Open (and log) the 127.0.0.1 URL we actually bound, not `localhost`: on
    // dual-stack Windows `localhost` may resolve to ::1 first and miss this
    // IPv4-only listener. `http://localhost:<port>` still works for the user.
    const url = `http://${HOST}:${port}`;
    console.log(`serve-dashboard listening on ${url} (serving ${htmlPath})`);
    console.log('  GET /                                → the dashboard HTML');
    console.log('  GET /api/attendance?from=&to=&source= → live attendance pull as JSON');
    console.log('  GET /api/absences?from=&to=&source=   → live absences pull as JSON');
    openBrowser(url);
  });
}

main();
