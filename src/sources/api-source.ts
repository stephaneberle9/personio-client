import type { PersonioClient } from '../client.js';
import type { AttendanceRecord } from '../model/attendance-record.js';
import type { AbsenceRecord } from '../model/absence-record.js';
import type { AttendanceStatus } from '../endpoints/attendancePeriods.js';
import type { AttendancePeriod, CostCenter, Person, Project } from '../schemas/index.js';
import {
  resolveBoolean,
  resolveFieldConfig,
  resolveString,
  type FieldResolverConfig,
} from '../fields/resolvers.js';
import { durationHours, round2 } from '../domain/hours.js';
import type { AbsenceSource, AttendanceSource, DateRange } from './types.js';

export interface ApiSourceOptions {
  /** Field-resolution overrides for account-specific custom fields. */
  fields?: Partial<FieldResolverConfig>;
  /** Attendance approval status to include. Defaults to `CONFIRMED` (concept §11). */
  attendanceStatus?: AttendanceStatus;
  /** Expensive project fields to expand via `includes`. */
  projectIncludes?: string[];
  /**
   * Optional remapping for the raw status enums the v2 API returns on periods
   * (e.g. `{ APPROVED: 'Genehmigt' }` to localize, or any other relabeling).
   * Each record's status is mapped through this table when building the domain
   * record; values without an entry pass through unchanged. When omitted,
   * statuses stay as the raw enum. The library core ships no labels of its own,
   * so supply the map from the consumer (see `examples/export-xlsx.ts`).
   */
  statusLabels?: Record<string, string>;
  /**
   * Opt-in: fetch the per-period absence breakdown to populate the amount
   * fields that the base `/v2/absence-periods` object does not carry. When
   * enabled, `getAbsence` issues one extra
   * `GET /v2/absence-periods/{id}/breakdowns` call per absence period (an N+1,
   * throttled to a small concurrency limit), sums the entries that fall inside
   * the queried range per unit, and fills `dailyAmount`/`durationDays` from
   * `DAY` units and `hourlyAmount`/`durationHours` from `HOUR` units. Fields
   * stay `null` when no in-range entry exists for that unit. Off by default —
   * the default leaves all four amounts `null` (byte-for-byte identical).
   */
  fetchAbsenceBreakdowns?: boolean;
}

/**
 * How many per-period breakdown requests (the opt-in N+1) may be in flight at
 * once. This only sets pipeline depth — the client's rate limiter governs the
 * actual request rate, pacing dispatches to the endpoint's token-bucket refill
 * rate, so a higher cap cannot exceed the safe rate. Personio caps
 * `/v2/absence-periods/{id}/breakdowns` at ~10 req/s (verified), and per-request
 * latency (~30 ms) is well under the resulting ~100 ms pacing gate, so only a
 * couple of requests need to be in flight to saturate it; a small cap suffices.
 */
const ABSENCE_BREAKDOWN_CONCURRENCY = 5;

/**
 * Attendance-periods pagination is the export's real bottleneck: Personio's
 * cursor pages get slower the deeper you go (page 1 ~130 ms, page 50 ~590 ms),
 * so a wide single query degrades badly. Splitting the `attribution_date` range
 * into fixed-width windows fetched in parallel keeps every page shallow (fast)
 * and lets the endpoint's ~10 req/s be the bound instead of cursor depth. The
 * windows tile the range with no overlap, so concatenating their results
 * reproduces the single-query set exactly.
 */
const ATTENDANCE_WINDOW_DAYS = 14;
/**
 * Max concurrent window fetches. All share the one `/v2/attendance-periods`
 * rate-limit bucket, so this only sets pipeline depth (enough to keep the
 * endpoint's rate saturated), not the request rate.
 */
const ATTENDANCE_WINDOW_CONCURRENCY = 8;

/** DAY/HOUR sums derived from an absence period's in-range breakdown entries. */
interface BreakdownSums {
  day: number | null;
  hour: number | null;
}

/** Build the grouping key for a work period: person + attribution date + project. */
function groupKey(period: AttendancePeriod): string {
  const date = period.attribution_date ?? period.start.date_time?.slice(0, 10) ?? '';
  return `${period.person.id} ${date} ${period.project?.id ?? ''}`;
}

/** First non-empty comment across a group's periods. */
function firstComment(periods: AttendancePeriod[]): string {
  for (const p of periods) {
    if (p.comment && p.comment.trim()) return p.comment.trim();
  }
  return '';
}

/**
 * Granular data source (concept §5, §11): joins attendance-periods with
 * projects, persons and cost-centers, and derives hours from the WORK periods.
 * Configuration-independent — works without a Custom Report.
 */
export class ApiSource implements AttendanceSource, AbsenceSource {
  private readonly fields: FieldResolverConfig;
  private readonly attendanceStatus: AttendanceStatus;
  private readonly projectIncludes: string[];
  private readonly statusLabels: Record<string, string>;
  private readonly fetchAbsenceBreakdowns: boolean;

  constructor(
    private readonly client: PersonioClient,
    options: ApiSourceOptions = {}
  ) {
    this.fields = resolveFieldConfig(options.fields);
    this.attendanceStatus = options.attendanceStatus ?? 'CONFIRMED';
    this.projectIncludes = options.projectIncludes ?? [];
    this.statusLabels = options.statusLabels ?? {};
    this.fetchAbsenceBreakdowns = options.fetchAbsenceBreakdowns ?? false;
  }

  /** Map a raw status enum through the configured labels, else pass it through. */
  private mapStatus(status: string): string {
    return this.statusLabels[status] ?? status;
  }

  async getAttendance(range: DateRange): Promise<AttendanceRecord[]> {
    const [periods, projects, persons, costCenters] = await Promise.all([
      this.listAttendancePeriods(range),
      this.client.projects.list({ includes: this.projectIncludes }),
      this.client.persons.list(),
      this.listCostCentersSafe(),
    ]);

    const projectsById = indexById(projects);
    const personsById = indexById(persons);
    // v2 projects carry only a cost-center *id*; resolve the display name (e.g.
    // "50101 Alten GmbH") from /v2/cost-centers.
    const costCenterNameById = new Map(costCenters.map((c) => [c.id, String(c.name ?? '')]));

    // Group WORK and BREAK periods separately by person+date+project; subtract
    // break time from work time within each group (concept §11).
    const workGroups = new Map<string, AttendancePeriod[]>();
    const breakGroups = new Map<string, AttendancePeriod[]>();
    for (const period of periods) {
      const target = period.type === 'BREAK' ? breakGroups : workGroups;
      const key = groupKey(period);
      const bucket = target.get(key);
      if (bucket) bucket.push(period);
      else target.set(key, [period]);
    }

    const records: AttendanceRecord[] = [];
    for (const [key, group] of workGroups) {
      const workHours = group.reduce(
        (sum, p) => sum + durationHours(p.start.date_time, p.end?.date_time),
        0
      );
      const breakHours = (breakGroups.get(key) ?? []).reduce(
        (sum, p) => sum + durationHours(p.start.date_time, p.end?.date_time),
        0
      );
      const hours = round2(Math.max(0, workHours - breakHours));
      if (hours <= 0) continue;

      const sample = group[0]!;
      const person = personsById.get(sample.person.id);
      // The period is booked on `booked`; the report shows its top-level
      // ancestor as "Anwesenheitsprojekt" and `booked` itself as the
      // "Unterprojekt" (verified against the reference report).
      const booked = sample.project?.id ? projectsById.get(sample.project.id) : undefined;
      const root = topLevelProject(booked, projectsById);

      records.push(
        this.toAttendanceRecord(sample, group, person, booked, root, hours, costCenterNameById)
      );
    }

    // Stable, human-friendly ordering: by date, then person, then project.
    records.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.lastName.localeCompare(b.lastName) ||
        a.project.localeCompare(b.project)
    );
    return records;
  }

  /**
   * Fetch attendance periods across the range, splitting it into
   * {@link ATTENDANCE_WINDOW_DAYS}-day windows fetched in parallel (bounded by
   * {@link ATTENDANCE_WINDOW_CONCURRENCY}) to avoid Personio's deep-cursor
   * slowdown. The windows tile the range, so the concatenation equals a single
   * query over the whole range.
   */
  private async listAttendancePeriods(range: DateRange): Promise<AttendancePeriod[]> {
    const windows = splitDateRange(range.from, range.to, ATTENDANCE_WINDOW_DAYS);
    const chunks = await mapWithConcurrency(windows, ATTENDANCE_WINDOW_CONCURRENCY, (window) =>
      this.client.attendancePeriods.list({
        attributionDateGte: window.from,
        attributionDateLte: window.to,
        status: this.attendanceStatus,
        sort: 'person.id,start.date_time',
      })
    );
    return chunks.flat();
  }

  private toAttendanceRecord(
    sample: AttendancePeriod,
    group: AttendancePeriod[],
    person: Person | undefined,
    booked: Project | undefined,
    root: Project | undefined,
    hours: number,
    costCenterNameById: Map<string, string>
  ): AttendanceRecord {
    const dyn = this.fields.dynamicFieldMap;
    // Cost center: prefer the name joined from the `{ id }` reference; fall back
    // to a flat cost-center field for tenants that expose one directly. The
    // customer, cost center, billable flag, code and dates all come from the
    // *booked* project (which may be a sub-project); only the displayed main
    // project name comes from the top-level ancestor.
    const costCenterId =
      booked?.cost_center && typeof booked.cost_center === 'object'
        ? booked.cost_center.id
        : undefined;
    const costCenter =
      (costCenterId ? costCenterNameById.get(costCenterId) : undefined) ||
      resolveString(booked, this.fields.costCenterFields, dyn);
    const isSubProject = !!(root && booked && root.id !== booked.id);
    return {
      personId: sample.person.id,
      personnelNumber: resolveString(person, this.fields.personnelNumberFields, dyn),
      lastName: String(person?.last_name ?? ''),
      firstName: String(person?.first_name ?? ''),
      customer: resolveString(booked, this.fields.customerFields, dyn),
      costCenter,
      project: String(root?.name ?? booked?.name ?? ''),
      projectCode: String(booked?.project_code ?? booked?.code ?? ''),
      subProject: isSubProject ? String(booked?.name ?? '') : '',
      date: sample.attribution_date ?? sample.start.date_time?.slice(0, 10) ?? '',
      hours,
      comment: firstComment(group),
      billable: resolveBoolean(booked, this.fields.billableFields, dyn),
      projectStart: String(booked?.start?.date ?? booked?.start_date ?? ''),
      projectEnd: String(booked?.end?.date ?? booked?.end_date ?? ''),
    };
  }

  /**
   * Cost-center id→object list, resilient to credentials without cost-center
   * access (the endpoint is beta): returns `[]` rather than failing the whole
   * attendance fetch.
   */
  private async listCostCentersSafe(): Promise<CostCenter[]> {
    try {
      return await this.client.costCenters.list();
    } catch {
      return [];
    }
  }

  async getAbsence(range: DateRange): Promise<AbsenceRecord[]> {
    const [periods, types, persons] = await Promise.all([
      this.client.absencePeriods.list({
        startsFromGte: `${range.from}T00:00:00Z`,
        startsFromLte: `${range.to}T23:59:59Z`,
      }),
      this.client.absenceTypes.list(),
      this.client.persons.list(),
    ]);

    const typeNameById = new Map(types.map((t) => [t.id, String(t.name ?? '')]));
    const personsById = indexById(persons);
    const dyn = this.fields.dynamicFieldMap;

    // Opt-in N+1: fetch each period's breakdown and sum the in-range entries per
    // unit. When disabled, the amounts stay null (byte-for-byte identical).
    const sumsById = this.fetchAbsenceBreakdowns
      ? await this.loadBreakdownSums(periods, range)
      : new Map<string, BreakdownSums>();

    const records = periods.map<AbsenceRecord>((p) => {
      const person = personsById.get(p.person.id);
      const sums = sumsById.get(p.id);
      return {
        personId: p.person.id,
        personnelNumber: resolveString(person, this.fields.personnelNumberFields, dyn),
        preferredName: resolveString(person, this.fields.preferredNameFields, dyn),
        firstName: String(person?.first_name ?? ''),
        lastName: String(person?.last_name ?? ''),
        department: resolveString(person, this.fields.departmentFields, dyn),
        absenceType: typeNameById.get(p.absence_type.id) ?? '',
        startDate: p.starts_from.date_time ?? '',
        endDate: p.ends_at?.date_time ?? null,
        // Amounts come from the per-id breakdown endpoint, fetched only when
        // `fetchAbsenceBreakdowns` is set (an opt-in N+1). Otherwise they stay
        // null. ReportSource fills these when configured instead.
        dailyAmount: sums?.day ?? null,
        durationDays: sums?.day ?? null,
        hourlyAmount: sums?.hour ?? null,
        durationHours: sums?.hour ?? null,
        comment: p.comment ?? '',
        status: this.mapStatus(p.approval?.status ?? ''),
        certificateStatus: resolveString(p, this.fields.certificateStatusFields, dyn),
      };
    });

    records.sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || a.lastName.localeCompare(b.lastName)
    );
    return records;
  }

  /**
   * Fetch each period's breakdown (throttled to {@link ABSENCE_BREAKDOWN_CONCURRENCY})
   * and reduce it to the in-range DAY/HOUR sums, keyed by absence-period id.
   */
  private async loadBreakdownSums(
    periods: { id: string }[],
    range: DateRange
  ): Promise<Map<string, BreakdownSums>> {
    const entries = await mapWithConcurrency(
      periods,
      ABSENCE_BREAKDOWN_CONCURRENCY,
      async (period) => {
        const breakdowns = await this.client.absencePeriods.breakdowns(period.id);
        return [period.id, sumBreakdowns(breakdowns, range)] as const;
      }
    );
    return new Map(entries);
  }
}

/**
 * Sum an absence period's breakdown entries per unit, counting only entries
 * whose date falls inside `[range.from, range.to]`. A unit with no in-range
 * entry stays `null` (so the record field is left untouched); otherwise the
 * summed value is rounded to two decimals to avoid float drift.
 */
function sumBreakdowns(
  breakdowns: Array<{
    date?: string | null;
    effective_duration?: { unit?: string | null; value?: number | null } | null;
  }>,
  range: DateRange
): BreakdownSums {
  let day: number | null = null;
  let hour: number | null = null;
  for (const entry of breakdowns) {
    const date = (entry.date ?? '').slice(0, 10);
    if (date < range.from || date > range.to) continue;
    const { unit, value } = entry.effective_duration ?? {};
    if (typeof value !== 'number') continue;
    if (unit === 'DAY') day = round2((day ?? 0) + value);
    else if (unit === 'HOUR') hour = round2((hour ?? 0) + value);
  }
  return { day, hour };
}

/**
 * Map `items` through `fn` with at most `limit` calls in flight, preserving
 * input order in the result. Used to bound the opt-in per-period breakdown N+1.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Add `days` to a `YYYY-MM-DD` date in UTC, returning `YYYY-MM-DD`. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Split an inclusive `[from, to]` date range (both `YYYY-MM-DD`) into
 * consecutive, non-overlapping windows of at most `windowDays` days. The windows
 * tile the range exactly — every date belongs to exactly one — so results
 * fetched per window concatenate back to the whole-range result with no gaps or
 * duplicates. Returns `[]` when `to < from`.
 */
export function splitDateRange(from: string, to: string, windowDays: number): DateRange[] {
  const windows: DateRange[] = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, windowDays - 1);
    windows.push({ from: start, to: end < to ? end : to });
    start = addDays(end, 1);
  }
  return windows;
}

/**
 * Walk `parent_project` links up to the top-level ancestor, which the reference
 * report shows as the "Anwesenheitsprojekt". Guards against cycles and missing
 * parents (returns the deepest resolvable ancestor).
 */
function topLevelProject(
  project: Project | undefined,
  byId: Map<string, Project>
): Project | undefined {
  let current = project;
  const seen = new Set<string>();
  while (current?.parent_project?.id && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parent_project.id);
    if (!parent) break;
    current = parent;
  }
  return current;
}
