# Open questions (to verify against a real Personio account)

These assumptions are marked `// VERIFY:` in the code. They cannot be confirmed
without a live Personio v2 account and are surfaced here so they are easy to find
and resolve on the first real API run. None of them block the architecture; each
is implemented as configurable behavior with a sensible default.

## Authentication & scopes

- **Exact OAuth2 scope names** for projects, cost centers, reports, document
  management, and recruiting. The `personio:<resource>:<action>` strings used in
  the scope-aware 403 hints (`src/errors.ts`) follow the documented convention,
  but Personio's docs are inconsistent. Confirm the real strings and pass them
  via `scopes` / the `PERSONIO_SCOPES` env var.
- **v1 is intentionally out of scope.** Personio deprecates the v1
  attendance/projects endpoints on 2026-08-30, so this client is v2-only. If a
  resource currently has no v2 equivalent your account needs, raise it
  separately rather than reintroducing v1.

## Field resolution (`src/fields/resolvers.ts`)

Concept doc 1 §8 lists these as unclear. Each is resolved from a configurable
list of candidate field names/labels (`FieldResolverConfig`), defaulting to
best-effort guesses:

- **Personnel number** ("Kostenträger Nummer"): standard field on `/v2/persons`
  or a custom (`dynamic_<id>`) attribute? → `personnelNumberFields`.
- **Customer** ("Anwesenheit Projekt Kunde"): project attribute, custom field, or
  derived from the cost center? → `customerFields`.
- **Cost center** on the project: which field/shape? → `costCenterFields`.
- **Billable** ("Anwesenheitsprojekt abrechenbar"): which project attribute, and
  its truthy representation (Ja/Nein vs boolean)? → `billableFields`.
- **Certificate status** ("Status Attest"): likely a custom/report field on the
  absence side. → `certificateStatusFields`.
- **Department**: from `/v2/persons` directly or via org units? → `departmentFields`.

## Absence amounts (`src/sources/api-source.ts`)

- The daily/hourly amounts and durations (`dailyAmount`, `durationDays`,
  `hourlyAmount`, `durationHours`) are **not** populated by the granular
  `ApiSource` by default — the v2 absence-period object does not carry them, and
  fetching them requires the per-id breakdown endpoint
  (`GET /v2/absence-periods/{id}/breakdowns`, one call per absence). They are
  left `null`. The `ReportSource` fills them when a Custom Report exposes them.
  Decide whether an opt-in breakdown fetch is needed for the Excel export.

## Cost centers (`src/endpoints/costCenters.ts`)

- `/v2/cost-centers` is beta and may require the `Beta: true` header on some
  plans. The current implementation does not send it; add it if the endpoint
  rejects the request.

## Reports (`src/endpoints/reports.ts`, `src/sources/report-source.ts`)

- **Exact path and payload shape** of the Reporting v2 read endpoint. The
  implementation defaults to `/v2/reports/{id}` and tolerates the common
  column/row shapes; confirm the real v2 path/payload against the account and
  override via `ReportsEndpointOptions.reportPath` if it differs. (The v1 Custom
  Reports API is intentionally not used — this is a v2-only client.)
- **Report column labels**: the default column-label candidates in
  `ReportSource` are guesses. Override `attendanceColumns` / `absenceColumns`
  with the real report's labels (incl. the NBSP/en-dash variants).
- **Report availability**: confirm the relevant Custom Report exists and the
  read endpoint is enabled for the credential.
