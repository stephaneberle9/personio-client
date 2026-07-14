import type { AbsenceRecord, AttendanceRecord, DateRange } from '../../../src/index.js';

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

/**
 * Excel number format string for the date columns, taken verbatim from the
 * reference spreadsheets (their date cells carry `dd\.mm\.yyyy`, the German
 * `dd.mm.yyyy` with the dots escaped). Reproducing it makes Excel render our
 * dates identically to the reference exports.
 */
const DATE_FORMAT = 'dd\\.mm\\.yyyy';

/** Excel number format for the numeric personnel number (integer, no decimals). */
const INTEGER_FORMAT = '0';

/**
 * Excel number format for the hour/amount columns, taken verbatim from the
 * reference spreadsheets (their "Erfasste Anwesenheitsstunden" and absence
 * amount cells carry `0.00` — two fixed decimals).
 */
const DECIMAL_FORMAT = '0.00';

/**
 * A materialized Excel cell as handed to SheetJS' `aoa_to_sheet`: a plain
 * value, an explicit typed cell (a number carrying a display format — used for
 * real date and numeric cells), or `null` for a *truly empty* cell (SheetJS
 * emits no cell at all, matching the reference where blank data cells are
 * absent rather than empty strings).
 */
export type Cell = string | number | null | { t: 'n'; v: number; z: string };

/**
 * Excel 1900-system serial for a calendar date, computed with UTC math so no
 * local-timezone offset can shift the date by a day (serial 0 = 1899-12-30).
 */
function excelSerial(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000);
}

/**
 * Turn an ISO date (or datetime) string into a real Excel date cell — a number
 * (serial) tagged with the reference date format. Only the calendar date is
 * used (any time part is ignored), matching the date-only reference cells.
 * Empty/absent values become an empty cell; a non-ISO string is passed through
 * unchanged as a text fallback.
 */
function dateCell(value: string | null | undefined): Cell {
  if (value === null || value === undefined || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return { t: 'n', v: excelSerial(Number(m[1]), Number(m[2]), Number(m[3])), z: DATE_FORMAT };
}

/**
 * The record keeps the personnel number as a string; the reference exports it
 * as a real integer cell ("Kostenträger Nummer", format `0`). Convert numeric
 * values to a number cell, fall back to the raw string for non-numeric values,
 * and emit an empty cell when there is none.
 */
function personnelNumberCell(value: string): Cell {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? { t: 'n', v: n, z: INTEGER_FORMAT } : value;
}

/**
 * A required numeric measure (e.g. recorded hours) as a number cell carrying
 * the reference two-decimal format.
 */
function decimalCell(value: number): Cell {
  return { t: 'n', v: value, z: DECIMAL_FORMAT };
}

/**
 * Optional numeric amount: a two-decimal number cell (matching the reference
 * `0.00` format), or an empty cell when `null`.
 */
function amountCell(value: number | null): Cell {
  return value === null ? null : decimalCell(value);
}

/** Free-text cell: the string, or an empty cell when blank (matches the reference). */
function textCell(value: string): Cell {
  return value === '' ? null : value;
}

/** Map an {@link AttendanceRecord} to one attendance row, aligned to the headers. */
export function attendanceRow(record: AttendanceRecord, range: DateRange): Cell[] {
  return [
    dateCell(range.from), // Startdatum (the query range)
    dateCell(range.to), // Enddatum
    personnelNumberCell(record.personnelNumber),
    textCell(record.lastName),
    textCell(record.firstName),
    textCell(record.customer),
    textCell(record.project),
    textCell(record.projectCode),
    textCell(record.subProject),
    dateCell(record.date), // Anwesenheitsdatum
    decimalCell(record.hours), // Erfasste Anwesenheitsstunden (format 0.00)
    textCell(record.comment),
    null, // "Projektleitung alt" — legacy column, not modelled (empty cell)
    record.billable ? 'Ja' : 'Nein',
    dateCell(record.projectStart), // Anwesenheitsprojekt – Startdatum
    dateCell(record.projectEnd), // Anwesenheitsprojekt – Enddatum
    textCell(record.costCenter),
  ];
}

/** Map an {@link AbsenceRecord} to one absence row, aligned to the headers. */
export function absenceRow(record: AbsenceRecord, range: DateRange): Cell[] {
  return [
    dateCell(range.from), // Startdatum (the query range)
    dateCell(range.to), // Enddatum
    personnelNumberCell(record.personnelNumber),
    textCell(record.preferredName),
    textCell(record.firstName),
    textCell(record.lastName),
    textCell(record.department),
    textCell(record.absenceType),
    dateCell(record.startDate), // Startdatum der Abwesenheit
    dateCell(record.endDate), // Enddatum der Abwesenheit (null → empty cell)
    amountCell(record.dailyAmount),
    amountCell(record.durationDays),
    amountCell(record.hourlyAmount),
    amountCell(record.durationHours),
    textCell(record.comment),
    textCell(record.status),
    textCell(record.certificateStatus),
  ];
}
