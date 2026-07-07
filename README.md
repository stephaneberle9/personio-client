# @stephaneberle9/personio-client

> Typed TypeScript client for the Personio v2 API — OAuth2, cursor pagination, and high-level services that normalize attendance and absence data. MIT.

A small, dependency-light **general client for the Personio v2 API**. It handles
OAuth2 client-credentials auth (with token caching), cursor pagination, and 429
retry/backoff, and exposes one typed endpoint group per resource —
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
   - plus project / cost-center / report scopes (exact names vary per account —
     see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)).

3. Provide credentials via environment (the examples load `.env` automatically):

   ```bash
   cp .env.example .env
   # then fill in PERSONIO_CLIENT_ID / PERSONIO_CLIENT_SECRET
   ```

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
already tuned to a verified account (see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)):
the personnel number is read from the `custom_attributes[]` array by its opaque
id, the customer from the project's `client_name`, and the cost-center name is
joined from `/v2/cost-centers`. Override the resolver candidates per account
instead of forking:

```ts
new ApiSource(client, {
  fields: {
    // Your account's personnel-number custom-field id (see OPEN_QUESTIONS.md).
    personnelNumberFields: ['dynamic_6322ffb59ab387.97097504'],
    customerFields: ['client_name'],
    costCenterFields: ['cost_center'],
  },
});
```

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
- `--source api|report` (default: `report` if `PERSONIO_REPORT_ID` is set, else `api`)

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

All account-specific values (cost centers, dashboard path) are **arguments** —
nothing is hardcoded. With `--inject-html`, a clearly marked block is inserted/
replaced; the page's manual Excel-import path keeps working as a fallback.

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
