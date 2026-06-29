import type { PersonioClient } from '../client.js';
import type { AttendanceRecord } from '../model/attendance-record.js';
import type { AbsenceRecord } from '../model/absence-record.js';
import type { ReportColumn, ReportData } from '../endpoints/reports.js';
import { slugifyLabel } from '../fields/resolvers.js';
import { round2 } from '../domain/hours.js';
import type { AbsenceSource, AttendanceSource, DateRange } from './types.js';

/**
 * Candidate column labels per record field. The first column whose (slugified)
 * label *contains* a candidate wins — the same fuzzy matching dashboards use, so
 * minor label variations (NBSP, en-dash, casing) still resolve. Defaults are
 * generic English/German guesses; override per account via {@link ReportSourceOptions}.
 */
export interface ReportColumnMap {
  [field: string]: string[];
}

export interface ReportSourceOptions {
  reportId: string;
  /** Column-label candidates for attendance fields. */
  attendanceColumns?: Partial<Record<keyof AttendanceRecord, string[]>>;
  /** Column-label candidates for absence fields. */
  absenceColumns?: Partial<Record<keyof AbsenceRecord, string[]>>;
  /** When true, filter report rows to the requested date range. */
  filterByRange?: boolean;
}

// VERIFY: default report column labels against the configured Custom Report.
const DEFAULT_ATTENDANCE_COLUMNS: Partial<Record<keyof AttendanceRecord, string[]>> = {
  personnelNumber: ['kostentraeger nummer', 'personnel number', 'personalnummer'],
  lastName: ['nachname', 'last name'],
  firstName: ['vorname', 'first name'],
  customer: ['kunde', 'customer'],
  costCenter: ['kostenstelle', 'cost center'],
  project: ['anwesenheitsprojekt', 'project'],
  projectCode: ['code'],
  subProject: ['unterprojekt', 'sub project', 'subproject'],
  date: ['anwesenheitsdatum', 'date'],
  hours: ['anwesenheitsstunden', 'hours', 'stunden'],
  comment: ['kommentar', 'comment'],
  billable: ['abrechenbar', 'billable'],
  projectStart: ['startdatum', 'start date'],
  projectEnd: ['enddatum', 'end date'],
};

const DEFAULT_ABSENCE_COLUMNS: Partial<Record<keyof AbsenceRecord, string[]>> = {
  personnelNumber: ['kostentraeger nummer', 'personnel number'],
  preferredName: ['name bevorzugt', 'preferred name', 'name'],
  firstName: ['vorname', 'first name'],
  lastName: ['nachname', 'last name'],
  department: ['abteilung', 'department'],
  absenceType: ['abwesenheitsart', 'absence type'],
  startDate: ['startdatum der abwesenheit', 'start date'],
  endDate: ['enddatum der abwesenheit', 'end date'],
  dailyAmount: ['taegliche', 'daily'],
  durationDays: ['tage', 'days'],
  hourlyAmount: ['stuendliche', 'hourly'],
  durationHours: ['stunden', 'hours'],
  comment: ['kommentar', 'comment'],
  status: ['status des abwesenheitszeitraums', 'status'],
  certificateStatus: ['status attest', 'certificate'],
};

/** Resolves report columns by fuzzy label matching and reads typed cell values. */
class ColumnResolver {
  private readonly slugByColumnId: Map<string, string>;

  constructor(private readonly columns: ReportColumn[]) {
    this.slugByColumnId = new Map(columns.map((c) => [c.id, slugifyLabel(c.label)]));
  }

  /** First column id whose slugified label contains any candidate slug. */
  findColumnId(candidates: string[]): string | undefined {
    const wanted = candidates.map((c) => slugifyLabel(c)).filter(Boolean);
    for (const column of this.columns) {
      const slug = this.slugByColumnId.get(column.id) ?? '';
      if (wanted.some((w) => slug.includes(w))) return column.id;
    }
    return undefined;
  }

  string(row: Record<string, unknown>, columnId: string | undefined): string {
    if (!columnId) return '';
    const value = row[columnId];
    return value === null || value === undefined ? '' : String(value).trim();
  }

  number(row: Record<string, unknown>, columnId: string | undefined): number {
    const raw = this.string(row, columnId);
    if (!raw) return 0;
    // Accept German decimal commas.
    const n = Number(raw.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : Number(raw) || 0;
  }
}

/**
 * Custom Report data source (concept §5): reproduces the normalized records
 * directly from a preconfigured Personio Custom Report, mapping report columns
 * (including `dynamic_<id>` columns resolved to labels) onto the record fields.
 * Fast and exact, but dependent on the report's configuration.
 */
export class ReportSource implements AttendanceSource, AbsenceSource {
  private readonly attendanceColumns: Partial<Record<keyof AttendanceRecord, string[]>>;
  private readonly absenceColumns: Partial<Record<keyof AbsenceRecord, string[]>>;

  constructor(
    private readonly client: PersonioClient,
    private readonly options: ReportSourceOptions
  ) {
    this.attendanceColumns = { ...DEFAULT_ATTENDANCE_COLUMNS, ...options.attendanceColumns };
    this.absenceColumns = { ...DEFAULT_ABSENCE_COLUMNS, ...options.absenceColumns };
  }

  async getAttendance(range: DateRange): Promise<AttendanceRecord[]> {
    const report = await this.client.reports.get(this.options.reportId);
    const cols = new ColumnResolver(report.columns);
    const id = mapColumnIds(cols, this.attendanceColumns);

    const records = report.rows.map<AttendanceRecord>((row) => ({
      personId: cols.string(row, id.personId),
      personnelNumber: cols.string(row, id.personnelNumber),
      lastName: cols.string(row, id.lastName),
      firstName: cols.string(row, id.firstName),
      customer: cols.string(row, id.customer),
      costCenter: cols.string(row, id.costCenter),
      project: cols.string(row, id.project),
      projectCode: cols.string(row, id.projectCode),
      subProject: cols.string(row, id.subProject),
      date: toDateStr(cols.string(row, id.date)),
      hours: round2(cols.number(row, id.hours)),
      comment: cols.string(row, id.comment),
      billable: parseBillable(cols.string(row, id.billable)),
      projectStart: toDateStr(cols.string(row, id.projectStart)),
      projectEnd: toDateStr(cols.string(row, id.projectEnd)),
    }));

    return this.options.filterByRange
      ? records.filter((r) => inRange(r.date, range))
      : records;
  }

  async getAbsence(range: DateRange): Promise<AbsenceRecord[]> {
    const report = await this.client.reports.get(this.options.reportId);
    const cols = new ColumnResolver(report.columns);
    const id = mapColumnIds(cols, this.absenceColumns);

    const records = report.rows.map<AbsenceRecord>((row) => ({
      personId: cols.string(row, id.personId),
      personnelNumber: cols.string(row, id.personnelNumber),
      preferredName: cols.string(row, id.preferredName),
      firstName: cols.string(row, id.firstName),
      lastName: cols.string(row, id.lastName),
      department: cols.string(row, id.department),
      absenceType: cols.string(row, id.absenceType),
      startDate: toDateStr(cols.string(row, id.startDate)),
      endDate: emptyToNull(toDateStr(cols.string(row, id.endDate))),
      dailyAmount: emptyToNullNumber(cols, row, id.dailyAmount),
      durationDays: emptyToNullNumber(cols, row, id.durationDays),
      hourlyAmount: emptyToNullNumber(cols, row, id.hourlyAmount),
      durationHours: emptyToNullNumber(cols, row, id.durationHours),
      comment: cols.string(row, id.comment),
      status: cols.string(row, id.status),
      certificateStatus: cols.string(row, id.certificateStatus),
    }));

    return this.options.filterByRange
      ? records.filter((r) => inRange(r.startDate, range))
      : records;
  }
}

/** Resolve every field's candidate labels to a concrete column id (or undefined). */
function mapColumnIds(
  cols: ColumnResolver,
  map: Record<string, string[] | undefined>
): Record<string, string | undefined> {
  const ids: Record<string, string | undefined> = {};
  for (const [field, candidates] of Object.entries(map)) {
    ids[field] = candidates ? cols.findColumnId(candidates) : undefined;
  }
  return ids;
}

function parseBillable(value: string): boolean {
  return ['ja', 'yes', 'true', '1', 'y'].includes(value.trim().toLowerCase());
}

/** Normalize a date cell to `YYYY-MM-DD`, tolerating ISO datetimes and `DD.MM.YYYY`. */
function toDateStr(value: string): string {
  if (!value) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(value);
  if (de) return `${de[3]}-${de[2]}-${de[1]}`;
  return value;
}

function inRange(date: string, range: DateRange): boolean {
  return !!date && date >= range.from && date <= range.to;
}

function emptyToNull(value: string): string | null {
  return value ? value : null;
}

function emptyToNullNumber(
  cols: ColumnResolver,
  row: Record<string, unknown>,
  columnId: string | undefined
): number | null {
  if (!columnId) return null;
  const raw = cols.string(row, columnId);
  return raw === '' ? null : cols.number(row, columnId);
}
