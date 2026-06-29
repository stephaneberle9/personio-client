# Contributing

Thanks for your interest in improving `@stephaneberle9/personio-client`.

## Development setup

Requires Node.js 20+.

```bash
npm install
```

## Workflow

| Task              | Command            |
| ----------------- | ------------------ |
| Type-check        | `npm run typecheck`|
| Run tests         | `npm test`         |
| Watch tests       | `npm run test:watch`|
| Build (dist/)     | `npm run build`    |
| Run an example    | `npm run example:xlsx -- --from 2026-06-01 --to 2026-06-30` |

Keep the build green: `npm run typecheck && npm test` should pass before every
commit.

## Project layout

```text
src/
  auth/        OAuth2 client-credentials token provider (in-memory cache)
  http/        axios wrapper: auth interceptor, cursor pagination, 429 retry
  endpoints/   one module per v2 resource (attendance/absence/projects/persons/
               cost-centers/reports/documents/recruiting)
  schemas/     zod schemas for the v2 responses
  fields/      configurable resolution of account-specific fields
  model/       normalized domain records (AttendanceRecord, AbsenceRecord, …)
  domain/      high-level services + hours computation
  sources/     ApiSource (granular) and ReportSource (Custom Report) + factory
  index.ts     public API surface
examples/      runnable tsx scripts (Excel export, dashboard snapshot)
test/          vitest tests with msw fixtures (no live API calls)
```

## Tests

- Tests use [vitest](https://vitest.dev) with [msw](https://mswjs.io) to mock
  the Personio API. **No test makes a live call** — fixtures are synthetic and
  anonymized.
- When adding an endpoint or changing transformation logic, add a test with a
  recorded/synthetic fixture. The minimum coverage to preserve: auth token
  cache, cursor pagination, hours computation (incl. the midnight case),
  attendance → record/dashboard mapping, and Excel header equality.

## Conventions

- **Language:** everything in the repo is English — code, comments, identifiers,
  CLI flags, error messages, and docs. American English spelling.
- **No account-specific constants** in `src/`: no cost-center numbers, customer
  names, exclusion lists, or references to a concrete dashboard file. Anything
  account- or evaluation-specific is runtime configuration (CLI argument or env)
  or lives in the examples.
- **No secrets** in code, tests, fixtures, snapshots, or logs.
- Assumptions that can only be checked against a live account are marked with a
  `// VERIFY:` comment and listed in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).

## Releasing

The package builds to ESM with type declarations via `tsup`. Publish targets can
be npm, the project's GitHub Packages registry, or an internal registry. Bump the
version in `package.json`, run `npm run build`, and publish the `dist/` output
(the `files` allowlist ships `dist`, `README.md`, and `LICENSE`).
