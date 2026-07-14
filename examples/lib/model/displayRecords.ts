import type { AttendanceRecord, AbsenceRecord } from '../../../src/index.js';

/**
 * Neutral, English-keyed attendance view rendered by the generic example
 * dashboard (`examples/dashboard.html`, "Attendance" card) and served as-is by
 * `/api/attendance`. `employee` is `"Last, First"`.
 *
 * The whole example pipeline speaks these English display records; a specific
 * consumer's localized shape (e.g. the German `SnapshotRecord` that a
 * `__PRELOADED_DATA__` dashboard expects) is produced only at the very end of the
 * chain by `model/snapshotData.ts`, not here.
 */
export interface AttendanceDisplayRecord {
  /** Attendance date `YYYY-MM-DD`. */
  date: string;
  /** "Last, First". */
  employee: string;
  customer: string;
  costCenter: string;
  project: string;
  subProject: string;
  hours: number;
  comment: string;
  /** Project start `YYYY-MM-DD`. */
  projectStart: string;
  /** Project end `YYYY-MM-DD`. */
  projectEnd: string;
}

/** Map a normalized {@link AttendanceRecord} to the example dashboard's attendance row. */
export function toAttendanceDisplayRecord(record: AttendanceRecord): AttendanceDisplayRecord {
  const employee = [record.lastName, record.firstName].filter(Boolean).join(', ');
  return {
    date: record.date,
    employee,
    customer: record.customer,
    costCenter: record.costCenter,
    project: record.project,
    subProject: record.subProject,
    hours: record.hours,
    comment: record.comment,
    projectStart: record.projectStart,
    projectEnd: record.projectEnd,
  };
}

/**
 * Neutral, English-keyed absence view rendered by the generic example dashboard
 * (`examples/dashboard.html`, "Absences" card) and served as-is by
 * `/api/absences`. `employee` is `"Last, First"`; `days` is `null` unless the
 * amount was resolved (the ApiSource does so when `fetchAbsenceBreakdowns` is
 * enabled).
 */
export interface AbsenceDisplayRecord {
  /** Absence start `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive absence end `YYYY-MM-DD`; `''` when open-ended. */
  endDate: string;
  /** "Last, First". */
  employee: string;
  department: string;
  /** Resolved absence type name. */
  type: string;
  /** Duration in days within the range; `null` when not resolved. */
  days: number | null;
  /** Approval status. */
  status: string;
}

/** Map a normalized {@link AbsenceRecord} to the example dashboard's absence row. */
export function toAbsenceDisplayRecord(record: AbsenceRecord): AbsenceDisplayRecord {
  const employee = [record.lastName, record.firstName].filter(Boolean).join(', ');
  return {
    startDate: record.startDate ? record.startDate.slice(0, 10) : '',
    endDate: record.endDate ? record.endDate.slice(0, 10) : '',
    employee,
    department: record.department,
    type: record.absenceType,
    days: record.durationDays,
    status: record.status,
  };
}
