import type { AbsenceRecord, AttendanceRecord, DateRange } from '../../src/index.js';

/**
 * Exact Excel output format reproduced by the export example. The header
 * strings, their order, and the sheet names are taken verbatim from the
 * reference spreadsheets so downstream tools (e.g. a controlling dashboard's
 * Excel import) keep working unchanged.
 *
 * Several headers contain a non-breaking space (U+00A0) and an en-dash
 * (U+2013) rather than a normal space/hyphen. These are written via the `NBSP`
 * / `DASH` constants below so the exact code points are unambiguous in source.
 *
 * These German labels are an *output format*, not library logic; they live in
 * the example, not in `src/`. They are not account-specific business constants.
 */

/** U+00A0 non-breaking space, as used between words in the report labels. */
const NBSP = ' ';
/** U+2013 en-dash, as used as a separator in the report labels. */
const DASH = '–';

/** Sheet names match the reference files (Excel truncates to 31 characters). */
export const ATTENDANCE_SHEET_NAME = 'Anwesenheitszeiträume nach Kund';
export const ABSENCE_SHEET_NAME = 'Abwesenheitszeiträume seit Apri';
export const MONTHLY_SHEET_NAME = 'Monatsbetrachtung Anwesenheitsz';

export const ATTENDANCE_HEADERS: readonly string[] = [
  'Startdatum',
  'Enddatum',
  'Kostenträger Nummer',
  'Nachname (bürgerlich)',
  'Vorname (bürgerlich)',
  `Anwesenheit Projekt${NBSP}Kunde Name`,
  'Anwesenheitsprojekt',
  `Anwesenheitsprojekt${NBSP}${DASH} Code`,
  `Anwesenheiten${NBSP}${DASH} Unterprojekt`,
  'Anwesenheitsdatum',
  'Erfasste Anwesenheitsstunden',
  'Kommentar zur Anwesenheit',
  'Projektleitung alt',
  'Anwesenheitsprojekt abrechenbar',
  `Anwesenheitsprojekt${NBSP}${DASH} Startdatum`,
  `Anwesenheitsprojekt${NBSP}${DASH} Enddatum`,
  `Anwesenheitsprojekt${NBSP}${DASH} Kostenstelle`,
];

export const ABSENCE_HEADERS: readonly string[] = [
  'Startdatum',
  'Enddatum',
  'Kostenträger Nummer',
  'Name (bevorzugt)',
  'Vorname (bürgerlich)',
  'Nachname (bürgerlich)',
  'Abteilung',
  'Abwesenheitsart',
  'Startdatum der Abwesenheit',
  'Enddatum der Abwesenheit',
  `Abwesenheit${NBSP}${DASH} tägliche Abwesenheitsarten`,
  `Dauer der Abwesenheit${NBSP}${DASH} Tage innerhalb des Zeitraums`,
  `Abwesenheit${NBSP}${DASH} stündliche Abwesenheitsarten`,
  `Dauer der Abwesenheit${NBSP}${DASH} Stunden innerhalb des Zeitraums`,
  'Kommentar zum Abwesenheitszeitraum',
  'Status des Abwesenheitszeitraums',
  'Status Attest',
];

/** Excel cell value, kept loose for SheetJS array-of-arrays input. */
type Cell = string | number;

/** Map an {@link AttendanceRecord} to one attendance row, aligned to the headers. */
export function attendanceRow(record: AttendanceRecord, range: DateRange): Cell[] {
  return [
    range.from, // Startdatum (the query range, per concept §10)
    range.to, // Enddatum
    record.personnelNumber,
    record.lastName,
    record.firstName,
    record.customer,
    record.project,
    record.projectCode,
    record.subProject,
    record.date,
    record.hours,
    record.comment,
    '', // "Projektleitung alt" — legacy column, not modelled
    record.billable ? 'Ja' : 'Nein',
    record.projectStart,
    record.projectEnd,
    record.costCenter,
  ];
}

/** Map an {@link AbsenceRecord} to one absence row, aligned to the headers. */
export function absenceRow(record: AbsenceRecord, range: DateRange): Cell[] {
  return [
    range.from, // Startdatum (the query range)
    range.to, // Enddatum
    record.personnelNumber,
    record.preferredName,
    record.firstName,
    record.lastName,
    record.department,
    record.absenceType,
    record.startDate,
    record.endDate ?? '',
    record.dailyAmount ?? '',
    record.durationDays ?? '',
    record.hourlyAmount ?? '',
    record.durationHours ?? '',
    record.comment,
    record.status,
    record.certificateStatus,
  ];
}
