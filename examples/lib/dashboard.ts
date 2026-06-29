import type { AttendanceRecord, DashboardRecord } from '../../src/index.js';

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
