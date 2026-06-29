import type { AttendanceRecord } from '../model/attendance-record.js';
import type { AbsenceRecord } from '../model/absence-record.js';

/** Inclusive query range in plain `YYYY-MM-DD` dates. */
export interface DateRange {
  from: string;
  to: string;
}

/** Produces normalized attendance records for a date range (concept §5). */
export interface AttendanceSource {
  getAttendance(range: DateRange): Promise<AttendanceRecord[]>;
}

/** Produces normalized absence records for a date range (concept §5). */
export interface AbsenceSource {
  getAbsence(range: DateRange): Promise<AbsenceRecord[]>;
}
