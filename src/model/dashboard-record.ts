/**
 * Dashboard record format consumed by HTML controlling dashboards that read a
 * `__PRELOADED_DATA__` array on startup (concept §8/§9). German field names are
 * intentional: they match what such a dashboard's row normalizer expects.
 *
 * This type is a convenience for the snapshot example; it is deliberately
 * generic (no account-specific cost centers or names) — those are supplied at
 * runtime by the example script.
 */
export interface DashboardRecord {
  /** Attendance date `YYYY-MM-DD`. */
  datum: string;
  /** "Nachname, Vorname". */
  ma: string;
  /** Customer. */
  kunde: string;
  /** Cost center. */
  kst: string;
  /** Project. */
  projekt: string;
  /** Sub-project. */
  up: string;
  /** Hours. */
  std: number;
  kommentar: string;
  startdatum: string;
  enddatum: string;
}
