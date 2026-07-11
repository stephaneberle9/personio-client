import type { AttendanceRecord } from '../../../src/index.js';

/**
 * Dashboard record format consumed by HTML controlling dashboards that read a
 * `__PRELOADED_DATA__` array on startup (concept §8/§9). German field names are
 * intentional: they match what such a dashboard's row normalizer expects.
 *
 * This is one concrete output format, so it lives in the example (not the
 * library) alongside its mapper — the library core exchanges the neutral,
 * English {@link AttendanceRecord}, and each consumer maps *from* it (the Excel
 * example has its own German column mapping the same way).
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

/**
 * Map a normalized {@link AttendanceRecord} to the dashboard record format
 * `{ datum, ma, kunde, kst, projekt, up, std, kommentar, startdatum, enddatum }`
 * consumed by a controlling dashboard that reads `__PRELOADED_DATA__` on startup
 * (concept §8/§9). `ma` is `"Nachname, Vorname"`.
 *
 * This lives in the example (not the library): it is one concrete output format.
 */
export function toDashboardRecord(record: AttendanceRecord): DashboardRecord {
  const ma = [record.lastName, record.firstName].filter(Boolean).join(', ');
  return {
    datum: record.date,
    ma,
    kunde: record.customer,
    kst: record.costCenter,
    projekt: record.project,
    up: record.subProject,
    std: record.hours,
    kommentar: record.comment,
    startdatum: record.projectStart,
    enddatum: record.projectEnd,
  };
}
