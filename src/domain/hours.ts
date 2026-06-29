/**
 * Parse a Personio datetime into epoch milliseconds, interpreting the components
 * in UTC. Attendance datetimes arrive without a timezone offset (e.g.
 * `2026-06-01T23:00:00`); parsing both endpoints the same way makes the
 * *difference* correct regardless of zone, and sidesteps host-local DST shifts
 * that `new Date("...")` would apply. A trailing `Z` or offset is respected.
 */
export function parseDateTimeMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  // If it already carries a zone designator, let Date handle it.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  const [, y, mo, d, h, min, s] = m;
  return Date.UTC(+y!, +mo! - 1, +d!, +h!, +min!, s ? +s : 0);
}

/**
 * Hours between two Personio datetimes. Returns `0` when `end` is missing (an
 * open/running period) or unparseable. Because both endpoints are full
 * datetimes, a period crossing midnight yields the correct positive duration —
 * the caller still groups by `attribution_date`, not by the calendar date of
 * `start`.
 */
export function durationHours(
  start: string | null | undefined,
  end: string | null | undefined
): number {
  const startMs = parseDateTimeMs(start);
  const endMs = parseDateTimeMs(end);
  if (startMs === undefined || endMs === undefined) return 0;
  const diff = endMs - startMs;
  return diff > 0 ? diff / 3_600_000 : 0;
}

/** Round to two decimals, avoiding binary-float noise (e.g. 7.5000000001). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
