/**
 * Normalized attendance row — the stable exchange format of the library
 * (concept §6). Both data sources (granular API and Custom Report) produce
 * this shape, and every consumer (Excel export, dashboard snapshot) maps *from*
 * it. Field names are neutral English; output-specific labels live in the
 * example scripts.
 */
export interface AttendanceRecord {
  personId: string;
  /** "Kostenträger Nummer" — the personnel number (a custom field per account). */
  personnelNumber: string;
  lastName: string;
  firstName: string;
  /** Customer the project belongs to ("Anwesenheit Projekt Kunde"). */
  customer: string;
  /** Cost center, e.g. "50101 Alten GmbH". */
  costCenter: string;
  /** Project name ("Anwesenheitsprojekt"). */
  project: string;
  /** Project code, e.g. "25243-1". */
  projectCode: string;
  /** Sub-project name ("Anwesenheiten Unterprojekt"). */
  subProject: string;
  /** Attendance date `YYYY-MM-DD` (the period's `attribution_date`). */
  date: string;
  /** Recorded hours: Σ(WORK end − start) for the date + project group. */
  hours: number;
  comment: string;
  /** Whether the project is billable ("Anwesenheitsprojekt abrechenbar"). */
  billable: boolean;
  projectStart: string;
  projectEnd: string;
}
