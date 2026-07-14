/**
 * Normalized absence row — the stable exchange format for absences.
 * Field names are neutral English; the Excel example maps them to the German
 * report column labels.
 */
export interface AbsenceRecord {
  personId: string;
  /** "Kostenträger Nummer" — the personnel number (a custom field per account). */
  personnelNumber: string;
  /** "Name (bevorzugt)" — preferred display name. */
  preferredName: string;
  firstName: string;
  lastName: string;
  department: string;
  /** Resolved absence type name ("Abwesenheitsart"). */
  absenceType: string;
  /** Absence start `YYYY-MM-DD` (or ISO datetime). */
  startDate: string;
  /** Absence end; `null` for an open-ended absence. */
  endDate: string | null;
  /** Daily amount; `null` unless resolved (e.g. via the breakdown endpoint). */
  dailyAmount: number | null;
  durationDays: number | null;
  hourlyAmount: number | null;
  durationHours: number | null;
  comment: string;
  /** Approval status of the absence period. */
  status: string;
  /** Certificate status ("Status Attest") — account-specific, often a custom field. */
  certificateStatus: string;
}
