/**
 * Probe Personio v2's rate-limit response headers so the client can pace itself
 * precisely instead of probing for 429s (see OPEN_QUESTIONS.md, "Rate limiting").
 *
 * Personio fronts the API with a Spring Cloud Gateway token-bucket limiter and
 * exposes the bucket state on every response:
 *   x-ratelimit-replenish-rate     tokens refilled per second (sustained rate)
 *   x-ratelimit-burst-capacity     bucket size (max burst)
 *   x-ratelimit-requested-tokens   token cost per request
 *   x-ratelimit-remaining          tokens left right now
 * There is no `Retry-After` on the 429 (confirmed) — so the client backs off.
 *
 * This script (1) reads the headers on a healthy 200 and (2) fires a concurrent
 * burst to force a 429 and capture that response's headers, then writes a JSON
 * report with a computed interpretation. The access token and client secret are
 * never written to the output.
 *
 * Usage (from the repo root):
 *
 *   npx tsx scripts/probe-ratelimit.ts [--env-file <path>] [--out <file>]
 *                                      [--burst <n>] [--concurrency <n>]
 *
 * Flags:
 *   --env-file <path>   .env with PERSONIO_CLIENT_ID / _SECRET (and optional
 *                       _BASE_URL). Default: ./.env via dotenv (which honors
 *                       DOTENV_CONFIG_PATH), or whatever is already in the env.
 *   --out <file>        result file, JSON (default: ratelimit-probe.json)
 *   --burst <n>         requests to fire in the burst (default: 400)
 *   --concurrency <n>   max requests in flight during the burst (default: 60)
 */
import { config as loadEnv } from 'dotenv';
import { writeFileSync } from 'node:fs';

const RATE_HEADER_RE = /ratelimit|rate-limit|retry-after|x-rate|quota|throttle/i;
const PROBE_PATH = '/v2/persons?limit=1';

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

/** All response headers as a plain object (fetch lowercases the keys). */
function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

/** Only the rate-limit-related headers, for a compact highlight. */
function rateHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => RATE_HEADER_RE.test(k)));
}

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Run `fn` over `count` items with at most `limit` in flight. */
async function burst<R>(count: number, limit: number, fn: (i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(count);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < count) {
      const i = next++;
      results[i] = await fn(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, count) }, () => worker()));
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out ?? 'ratelimit-probe.json';
  const burstCount = num(args.burst) ?? 400;
  const concurrency = num(args.concurrency) ?? 60;

  // Honor --env-file, else DOTENV_CONFIG_PATH (as the `dotenv/config` the
  // examples use does), else the default ./.env.
  const envFile = args['env-file'] || process.env.DOTENV_CONFIG_PATH;
  if (envFile) loadEnv({ path: envFile, override: true });
  else loadEnv();

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
  if (!tokenResponse.ok) {
    console.error(`Token request failed: ${tokenResponse.status}`);
    process.exit(1);
  }
  const accessToken = ((await tokenResponse.json()) as { access_token?: string }).access_token ?? '';
  if (!accessToken) {
    console.error('Token response contained no access_token.');
    process.exit(1);
  }
  const authHeaders = { Authorization: `Bearer ${accessToken}` };
  const url = `${baseUrl}${PROBE_PATH}`;

  // 1. Headers on a healthy 200.
  const healthyResponse = await fetch(url, { headers: authHeaders });
  const healthyHeaders = headersToObject(healthyResponse.headers);

  // 2. Burst to force a 429.
  const statuses = await burst(burstCount, concurrency, async () => {
    const r = await fetch(url, { headers: authHeaders });
    return { status: r.status, headers: headersToObject(r.headers) };
  });
  const distribution: Record<string, number> = {};
  for (const s of statuses) distribution[s.status] = (distribution[s.status] ?? 0) + 1;
  const sample429 = statuses.find((s) => s.status === 429) ?? null;

  const interpretation = {
    replenishRatePerSec: num(healthyHeaders['x-ratelimit-replenish-rate']),
    burstCapacity: num(healthyHeaders['x-ratelimit-burst-capacity']),
    requestedTokensPerRequest: num(healthyHeaders['x-ratelimit-requested-tokens']),
    retryAfterPresentOn429: sample429 ? 'retry-after' in sample429.headers : null,
    steadyIntervalMs: (() => {
      const r = num(healthyHeaders['x-ratelimit-replenish-rate']);
      const cost = num(healthyHeaders['x-ratelimit-requested-tokens']) ?? 1;
      return r && r > 0 ? Math.ceil((1000 * cost) / r) : null;
    })(),
  };

  const report = {
    probedAt: new Date().toISOString(),
    baseUrl,
    path: PROBE_PATH,
    healthy: { status: healthyResponse.status, rateLimit: rateHeaders(healthyHeaders), allHeaders: healthyHeaders },
    burst: {
      total: burstCount,
      concurrency,
      distribution,
      sample429: sample429
        ? { status: 429, rateLimit: rateHeaders(sample429.headers), allHeaders: sample429.headers }
        : null,
    },
    interpretation,
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`Healthy 200 rate-limit headers:`);
  for (const [k, v] of Object.entries(report.healthy.rateLimit)) console.log(`  ${k}: ${v}`);
  console.log(`\nBurst of ${burstCount} (concurrency ${concurrency}):`);
  for (const [code, n] of Object.entries(distribution)) console.log(`  ${code}: ${n}`);
  if (sample429) {
    console.log(`\n429 rate-limit headers:`);
    for (const [k, v] of Object.entries(report.burst.sample429!.rateLimit)) console.log(`  ${k}: ${v}`);
  } else {
    console.log(`\nNo 429 encountered — the 200 headers above may already be enough.`);
  }
  console.log(
    `\nInterpretation: ~${interpretation.replenishRatePerSec ?? '?'} req/s sustained, ` +
      `burst ${interpretation.burstCapacity ?? '?'}, steady interval ${interpretation.steadyIntervalMs ?? '?'} ms, ` +
      `Retry-After on 429: ${interpretation.retryAfterPresentOn429 ?? 'unknown'}`
  );
  console.log(`\nFull report → ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
