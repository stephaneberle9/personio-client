/**
 * Final-boundary mapper: turns the pipeline's neutral, English
 * {@link AttendanceDisplayRecord}s into the German {@link SnapshotRecord} shape
 * that a specific *external* consumer dashboard reads from its `__PRELOADED_DATA__`
 * array on startup — not the bundled `examples/dashboard.html`,
 * which renders the English records directly.
 *
 * This is the *only* place German field names appear — the rest of the example
 * chain (services, sources, builders, `/api/*` endpoints, `dashboard.html`) speaks
 * English display records. It is also where the audit `meta` block is stamped:
 * the live dashboard has no use for provenance, so `meta` is attached only here,
 * on the road to the persisted artifact. `generate-snapshot.ts` calls this right
 * before writing the JSON file and injecting the HTML.
 */
import type { SourceKind } from '../../../src/index.js';
import type { AttendanceDisplayRecord } from './displayRecords.js';

/**
 * German-keyed attendance record for an external controlling dashboard that reads
 * a `__PRELOADED_DATA__` array on startup. The German field names
 * are intentional: they match what such a dashboard's row normalizer expects.
 */
export interface SnapshotRecord {
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

/** Audit-trail metadata stamped onto the snapshot artifact. */
export interface SnapshotMeta {
  from: string;
  to: string;
  source: string;
  reportId: string | null;
  generatedAt: string;
  count: number;
}

/** The snapshot: German attendance records plus the audit `meta` block. */
export interface Snapshot {
  records: SnapshotRecord[];
  meta: SnapshotMeta;
}

/** Map an English {@link AttendanceDisplayRecord} to the German {@link SnapshotRecord}. */
export function toSnapshotRecord(record: AttendanceDisplayRecord): SnapshotRecord {
  return {
    datum: record.date,
    ma: record.employee,
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

/** Range/source context needed to stamp the {@link SnapshotMeta} audit block. */
export interface SnapshotRange {
  from: string;
  to: string;
  source: SourceKind;
  /** Custom Report id; only recorded when `source` is `report`. */
  reportId?: string | null;
}

/**
 * Localize English {@link AttendanceDisplayRecord}s to the German
 * {@link Snapshot}, stamping the audit `meta` block from `range` (a leftover
 * reportId is nulled out for an api-source artifact) plus a generation timestamp
 * and record count.
 */
export function toSnapshot(
  records: AttendanceDisplayRecord[],
  range: SnapshotRange
): Snapshot {
  const snapshot = records.map(toSnapshotRecord);
  return {
    records: snapshot,
    meta: {
      from: range.from,
      to: range.to,
      source: range.source,
      reportId: range.source === 'report' ? range.reportId ?? null : null,
      generatedAt: new Date().toISOString(),
      count: snapshot.length,
    },
  };
}
