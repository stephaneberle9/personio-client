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

  constructor(
    private readonly client: PersonioClient,
    options: ApiSourceOptions = {}
  ) {
    this.fields = resolveFieldConfig(options.fields);
    this.attendanceStatus = options.attendanceStatus ?? 'CONFIRMED';
    this.projectIncludes = options.projectIncludes ?? [];
    this.statusLabels = options.statusLabels ?? {};
  }

  /** Map a raw status enum through the configured labels, else pass it through. */
  private mapStatus(status: string): string {
    return this.statusLabels[status] ?? status;
  }

  async getAttendance(range: DateRange): Promise<AttendanceRecord[]> {
    const [periods, projects, persons, costCenters] = await Promise.all([
      this.client.attendancePeriods.list({
        attributionDateGte: range.from,
        attributionDateLte: range.to,
        status: this.attendanceStatus,
        sort: 'person.id,start.date_time',
      }),
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

    const records = periods.map<AbsenceRecord>((p) => {
      const person = personsById.get(p.person.id);
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
        // Amounts come from the per-id breakdown endpoint, which is not called
        // by default (an opt-in N+1). ReportSource fills these when configured.
        dailyAmount: null,
        durationDays: null,
        hourlyAmount: null,
        durationHours: null,
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
}

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
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
