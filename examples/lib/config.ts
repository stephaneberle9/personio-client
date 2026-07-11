/**
 * Non-secret, account/locale configuration for the example scripts.
 *
 * Everything here is *account-scoped* — it belongs to the Personio account, not
 * to a single run — and is *not* a secret (credentials stay in `.env`). Supply
 * it as a JSON file via `--config ./personio.config.json` to keep invocations
 * short. Every value also falls back to a `PERSONIO_*` environment variable,
 * which is handy server-side where shipping a file is awkward. Precedence:
 * config file > environment > built-in default.
 *
 * Two values (`reportId`, `costCenters`) are account-scoped but *selected per
 * run* — an account has several reports and cost centers, and each run picks
 * one. The examples let a `--report-id` / `--cost-centers` flag override the
 * default resolved here, for that invocation only.
 */
import { readFileSync } from 'node:fs';
import { parseList } from './args.js';

/** Shape of the optional `personio.config.json` file (all keys optional). */
export interface ExampleConfig {
  /**
   * Default Custom Report id for the ReportSource (env: `PERSONIO_REPORT_ID`).
   * Account-scoped but selected per run — an account has several reports — so a
   * `--report-id` CLI flag overrides this default for a given invocation.
   */
  reportId?: string;
  /**
   * The account's opaque personnel-number ("Kostenträger Nummer") custom-field
   * id(s); first match wins (env: `PERSONIO_PERSONNEL_FIELD_IDS`).
   */
  personnelFieldIds?: string[];
  /** Raw v2 status enum → display label, e.g. `APPROVED` → `"Genehmigt"`. */
  statusLabels?: Record<string, string>;
  /** Default cost-center pre-filter; a `--cost-centers` CLI flag overrides it. */
  costCenters?: string[];
}

/**
 * German localization of the v2 absence status enums, matching the labels the
 * legacy Custom Report Excel export shows in the "Status des
 * Abwesenheitszeitraums" column. Used as the default when the config file does
 * not set `statusLabels`, so a zero-config run still reaches 1:1 parity with the
 * German reference report. This is an output format, not library logic.
 */
export const DEFAULT_STATUS_LABELS_DE: Record<string, string> = {
  APPROVED: 'Genehmigt',
  PENDING: 'Ausstehend',
  REJECTED: 'Abgelehnt',
};

/** Example configuration with environment fallbacks and defaults applied. */
export interface ResolvedExampleConfig {
  reportId?: string;
  personnelFieldIds?: string[];
  statusLabels: Record<string, string>;
  costCenters?: string[];
}

/** Read and shallow-validate the JSON config file, with clear error messages. */
function readConfigFile(path: string): ExampleConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Config file not found or unreadable: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Config file is not valid JSON (${path}): ${error instanceof Error ? error.message : error}`
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config file must contain a JSON object (${path})`);
  }
  return parsed as ExampleConfig;
}

/**
 * Load and resolve the example configuration: read the optional JSON file at
 * `configPath` (a `--config` argument value), then fill each gap from the
 * environment and, last, the built-in defaults.
 */
export function loadExampleConfig(
  options: { configPath?: string | boolean | undefined; env?: NodeJS.ProcessEnv } = {}
): ResolvedExampleConfig {
  const env = options.env ?? process.env;
  const file = typeof options.configPath === 'string' && options.configPath.length
    ? readConfigFile(options.configPath)
    : {};

  const envPersonnel = parseList(env.PERSONIO_PERSONNEL_FIELD_IDS);
  const filePersonnel = file.personnelFieldIds?.length ? file.personnelFieldIds : undefined;

  return {
    reportId: file.reportId ?? env.PERSONIO_REPORT_ID ?? undefined,
    personnelFieldIds: filePersonnel ?? (envPersonnel.length ? envPersonnel : undefined),
    statusLabels: file.statusLabels ?? DEFAULT_STATUS_LABELS_DE,
    costCenters: file.costCenters,
  };
}
