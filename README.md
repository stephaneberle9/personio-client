# @stephaneberle9/personio-client

> Typed TypeScript client for the Personio v2 API — OAuth2, cursor pagination, and high-level services that normalize attendance and absence data. MIT.

A small, dependency-light **general client for the Personio v2 API**. It handles
OAuth2 client-credentials auth (with token caching), cursor pagination, transient
retry/backoff (429 plus 5xx / network errors on idempotent requests), a
per-endpoint request throttle seeded from Personio's rate-limit headers, and
exposes one typed endpoint group per resource —
attendance periods, absence periods, absence types, projects, persons, cost
centers, custom reports, document management, and recruiting.

On top of the raw endpoints it adds high-level services that normalize
**attendance** and **absence** data into stable records you can export or
visualize, and two runnable examples: an **Excel exporter** and a **dashboard
snapshot generator**.

> [!NOTE]
> This is a **v2-only** client. Personio deprecates the v1 attendance/projects
> endpoints on **2026-08-30**, so the legacy v1 endpoints are intentionally not
> included.

## Features

- **OAuth2 client credentials** against `POST /v2/auth/token`, token cached in
  memory and refreshed 60s before expiry.
- **Low-level endpoints** (one group per resource): attendance periods
  (incl. create/update/delete), absence periods, absence types, projects
  (+ members), persons, cost centers, custom reports, document management
  (list/download/delete), and recruiting (applications, candidates, jobs,
  categories, stage transitions) — with automatic cursor pagination
  (`_meta.links.next`).
- **High-level services**: `AttendanceService` / `AbsenceService` (normalized
  records for a date range), plus `PersonService` and `RecruitingService` that
  flatten v2 persons and recruiting objects into typed records.
- **Two interchangeable data sources** behind one interface: `ApiSource`
  (granular: joins periods + projects + persons + cost centers and derives
  hours) and `ReportSource` (a preconfigured Personio Custom Report).
- **Derived hours**: v2 has no hours field — hours are computed as
  Σ(WORK `end − start`) grouped by `attribution_date` + `project.id`, which is
  correct even when a period crosses midnight.
- **Configurable field resolution** for the account-specific fields Personio
  exposes inconsistently (personnel number, customer, cost center, billable,
  certificate status) — no business constants are hardcoded.
- **zod**-validated config and responses; **vitest** tests with recorded
  fixtures (no live calls in CI).

## Requirements

- Node.js **20+**, ESM.
- A Personio **v2 API credential** (client id + secret).

## Install

```bash
npm install @stephaneberle9/personio-client
```

## Setup (credentials & scopes)

1. In Personio, create an API credential (Settings → Integrations → API
   credentials) and note the **client id** and **client secret**.
2. Grant the credential the access rights / scopes it needs. Observed scopes:

   - `personio:attendances:read`
   - `personio:absences:read`
   - `personio:persons:read`
   - plus project / cost-center / report scopes (exact names vary per account).

3. Provide credentials via environment (the examples load `.env` automatically):

   ```bash
   cp .env.example .env
   # then fill in PERSONIO_CLIENT_ID / PERSONIO_CLIENT_SECRET
   ```

   Heavy exports (wide date ranges, or absence with `--absence-breakdowns`) do a
   lot of pagination and per-record N+1 calls. The client throttles itself
   automatically: Personio reports its token-bucket state on every response
   (`x-ratelimit-*`), and the client paces requests to the endpoint's refill rate
   so it stays under the limit without any configuration. (Where those headers
   are absent it falls back to reacting to 429s.) Note the limits are
   **per-endpoint** — e.g. `/v2/absence-periods/{id}/breakdowns` is ~10 req/s — so
   a large absence export with breakdowns is inherently paced at that rate. Set
   `PERSONIO_MIN_REQUEST_INTERVAL_MS` only to impose a steady-state floor (slow
   things down further); the default of `0` lets it self-pace.

> [!IMPORTANT]
> **Personio blocks browser calls via CORS** and warns against putting the
> client id/secret in a browser. A web page must therefore never call Personio
> directly. This library is meant to run **server-side / in a script** that holds
> the secret and produces normalized data (e.g. an Excel file or a JSON
> snapshot) — which is exactly what the two examples do.

## Library usage

```ts
import {
  PersonioClient,
  ApiSource,
  AttendanceService,
  configFromEnv,
} from '@stephaneberle9/personio-client';

const client = new PersonioClient(configFromEnv()); // or pass a ClientConfig
const service = new AttendanceService(new ApiSource(client));

const records = await service.getRecords({ from: '2026-06-01', to: '2026-06-30' });
// records: AttendanceRecord[] — normalized, source-independent
```

Low-level endpoints are available too:

```ts
const periods = await client.attendancePeriods.list({
  attributionDateGte: '2026-06-01',
  attributionDateLte: '2026-06-30',
  status: 'CONFIRMED',
});
// `tracked_minutes` is returned inline on each project; do not pass `includes`
// (the v2 `/v2/projects` endpoint rejects it with 400).
const projects = await client.projects.list();
```

### Account-specific fields

Personio surfaces some values (personnel number, customer, cost center,
billable, certificate status) under account-specific keys. The defaults are
already tuned to a real Personio account shape:
the personnel number is read from the `custom_attributes[]` array by its opaque
id, the customer from the project's `client_name`, and the cost-center name is
joined from `/v2/cost-centers`. Override the resolver candidates per account
instead of forking:

```ts
new ApiSource(client, {
  fields: {
    // Your account's personnel-number custom-field id (opaque, per account).
    personnelNumberFields: ['dynamic_1234567890abcd.12345678'],
    customerFields: ['client_name'],
    costCenterFields: ['cost_center'],
  },
});
```

The bundled example scripts read this personnel-number id from the
`PERSONIO_PERSONNEL_FIELD_IDS` environment variable (see `.env.example`), so you
can point them at your account without editing code.

### Status label mapping

The v2 API returns raw status enums (`APPROVED`, `PENDING`, `REJECTED`, …) on
attendance- and absence-periods. Pass a `statusLabels` map to `ApiSource` to
remap them to labels of your choice when records are built — most commonly to
localize them (the legacy Custom Report export shows German labels), but any
relabeling works. Enum values without an entry pass through unchanged, and
omitting the option keeps the raw enum:

```ts
new ApiSource(client, {
  statusLabels: { APPROVED: 'Genehmigt', PENDING: 'Ausstehend', REJECTED: 'Abgelehnt' },
});
```

The library core ships no labels of its own. `ReportSource` is unaffected —
report cells already carry the label. See
[`examples/export-xlsx.ts`](examples/export-xlsx.ts) for the German map wired
into the Excel export.

### Absence amounts (breakdown fetch)

The base `/v2/absence-periods` object carries no amounts, so by default
`ApiSource` leaves `dailyAmount`, `durationDays`, `hourlyAmount` and
`durationHours` `null`. Set `fetchAbsenceBreakdowns: true` to populate them from
the per-period breakdown endpoint (`GET /v2/absence-periods/{id}/breakdowns`):

```ts
new ApiSource(client, { fetchAbsenceBreakdowns: true });
```

When enabled, `getAbsence` issues one extra call per absence period (an N+1,
throttled to a small concurrency limit), keeps only the breakdown entries whose
date falls inside the queried range, and sums them per unit — `DAY` units fill
`dailyAmount`/`durationDays`, `HOUR` units fill `hourlyAmount`/`durationHours`.
A unit with no in-range entry stays `null`. The default (option omitted) is
unchanged.

### Custom Report source

```ts
import { createSource } from '@stephaneberle9/personio-client';

const source = createSource(client, {
  kind: 'report',
  report: { reportId: process.env.PERSONIO_REPORT_ID! },
});
```

## Examples

Run with [`tsx`](https://github.com/privatenumber/tsx) (a dev dependency).

### Configuration

The examples separate three kinds of input:

- **Secrets** (`PERSONIO_CLIENT_ID` / `PERSONIO_CLIENT_SECRET`) — always in `.env`.
- **Per-run parameters** (`--from`, `--to`, `--type`, `--source`, `--out`, …) —
  CLI flags, since they change every run.
- **Non-secret account/locale config** (`reportId`, `personnelFieldIds`,
  `statusLabels`, default `costCenters`) — constant for an account, so it lives
  in one optional JSON file passed with `--config`. Copy
  [`personio.config.example.json`](personio.config.example.json) to
  `personio.config.json` (gitignored) and fill in your account's values:

  ```bash
  tsx examples/export-xlsx.ts --from 2026-06-01 --to 2026-06-30 \
    --type both --source api --out ./out \
    --config ./personio.config.json
  ```

  Each of those values also falls back to a `PERSONIO_*` environment variable
  (`PERSONIO_REPORT_ID`, `PERSONIO_PERSONNEL_FIELD_IDS`) — convenient for
  server-side use where a file is awkward. Precedence is **config file >
  environment > built-in default**, so `--config` is entirely optional.

### Excel export

Reproduces the reference report format exactly (sheet names, header order, and
exact labels, including non-breaking spaces and en-dashes).

```bash
tsx examples/export-xlsx.ts \
  --from 2026-06-01 --to 2026-06-30 \
  --type both \
  --source api \
  --out ./out
```

- `--type attendance|absence|both` (default `both`)
- `--source api|report` (default: `report` if a `reportId` is configured, else `api`)
- `--config <path>` — optional account/locale config (see [Configuration](#configuration))

### Dashboard snapshot

Writes an array of dashboard records (`{ datum, ma, kunde, kst, projekt, up,
std, kommentar, startdatum, enddatum }`) with an audit-trail header, and can
inject it into an HTML dashboard that reads `__PRELOADED_DATA__` on startup.

```bash
tsx examples/generate-snapshot.ts \
  --from 2026-06-01 --to 2026-06-30 \
  --cost-centers 1001,1002,1003 \
  --source api \
  --out snapshot.json \
  --inject-html ./dashboard.html
```

Nothing account-specific is hardcoded: per-run values (cost centers, dashboard
path) are **arguments**, and constant account config comes from `--config` or
`PERSONIO_*` env vars (see [Configuration](#configuration)). A `--cost-centers`
flag overrides the config file's default. With `--inject-html`, a clearly marked
block is inserted/replaced; the page's manual Excel-import path keeps working as
a fallback.

## How hours are computed

Personio v2 attendance periods carry start/end times but **no hours field**. The
library sums the duration of `WORK` periods (subtracting `BREAK` periods in the
same group) per `attribution_date` + `project.id`. Grouping by
`attribution_date` — not by the calendar date of `start` — keeps hours correct
for periods that cross midnight.

## Security & privacy

- Credentials are read only from the environment (`.env` in the examples); they
  are never written to snapshots, Excel files, or logs.
- The OAuth token is cached **in memory only**, never persisted.
- Generated files contain real names and project times — treat them as personal
  data and restrict access accordingly.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Stephan Eberle
