/**
 * Probe which v2 endpoints a credential can access and capture the raw
 * response bodies — especially 403s, which may name the missing OAuth2 scope.
 * Useful with a deliberately low-privilege credential to discover the real
 * `personio:<resource>:<action>` scope strings (see OPEN_QUESTIONS.md,
 * "Authentication & scopes").
 *
 * Usage (from the repo root):
 *
 *   npx tsx scripts/probe-scopes.ts [--env-file <path>] [--out <file>]
 *
 * Flags:
 *   --env-file <path>   .env file with PERSONIO_CLIENT_ID / PERSONIO_CLIENT_SECRET
 *                       (and optionally PERSONIO_BASE_URL). Default: ./.env via
 *                       dotenv, or whatever is already in the process env.
 *   --out <file>        result file, JSON (default: scope-probe.json)
 *
 * The access token and the client secret are never written to the output.
 */
import { config as loadEnv } from 'dotenv';
import { writeFileSync } from 'node:fs';

interface EndpointResult {
  path: string;
  status: number | null;
  ok: boolean;
  body: unknown;
  error?: string;
}

const MAX_BODY_CHARS = 4000;

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[i + 1] ?? '';
      i++;
    }
  }
  return args;
}

function truncate(text: string): string {
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… [truncated]` : text;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return truncate(text);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out ?? 'scope-probe.json';

  if (args['env-file']) {
    loadEnv({ path: args['env-file'], override: true });
  } else {
    loadEnv();
  }

  const clientId = process.env.PERSONIO_CLIENT_ID;
  const clientSecret = process.env.PERSONIO_CLIENT_SECRET;
  const baseUrl = process.env.PERSONIO_BASE_URL || 'https://api.personio.de';
  if (!clientId || !clientSecret) {
    console.error('PERSONIO_CLIENT_ID / PERSONIO_CLIENT_SECRET missing (check --env-file).');
    process.exit(2);
  }

  const tokenResponse = await fetch(`${baseUrl}/v2/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const token: { status: number; ok: boolean; body?: unknown } = {
    status: tokenResponse.status,
    ok: tokenResponse.ok,
  };
  let accessToken = '';
  if (tokenResponse.ok) {
    const payload = (await tokenResponse.json()) as { access_token?: string };
    accessToken = payload.access_token ?? '';
  } else {
    token.body = await readBody(tokenResponse);
  }

  const endpoints: Array<{ path: string; headers?: Record<string, string> }> = [
    { path: '/v2/attendance-periods' },
    { path: '/v2/absence-periods' },
    { path: '/v2/absence-types' },
    { path: '/v2/persons' },
    { path: '/v2/projects' },
    { path: '/v2/cost-centers', headers: { Beta: 'true' } },
    { path: '/v2/reports' },
  ];

  const results: EndpointResult[] = [];
  for (const endpoint of endpoints) {
    if (!accessToken) {
      results.push({ path: endpoint.path, status: null, ok: false, body: null, error: 'no token' });
      continue;
    }
    try {
      const response = await fetch(`${baseUrl}${endpoint.path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, ...endpoint.headers },
      });
      results.push({
        path: endpoint.path,
        status: response.status,
        ok: response.ok,
        body: response.ok ? '[ok, body omitted]' : await readBody(response),
      });
    } catch (error) {
      results.push({
        path: endpoint.path,
        status: null,
        ok: false,
        body: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    probedAt: new Date().toISOString(),
    baseUrl,
    envFile: args['env-file'] ?? null,
    token,
    endpoints: results,
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`Token: ${token.status}${token.ok ? '' : ' (FAILED)'}`);
  for (const r of results) {
    console.log(`  ${r.path.padEnd(26)} ${r.status ?? 'ERR'}${r.status === 403 ? '  ← check body for scope name' : ''}`);
  }
  console.log(`\nFull results (incl. 403 bodies) → ${outPath}`);
  process.exit(token.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
