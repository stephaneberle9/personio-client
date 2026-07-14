import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ABSENCE_HEADERS,
  ABSENCE_SHEET_NAME,
  ATTENDANCE_HEADERS,
  ATTENDANCE_SHEET_NAME,
  MONTHLY_SHEET_NAME,
  attendanceRow,
  absenceRow,
} from '../examples/lib/model/sheetContent.js';
import { buildSheetWorkbook, readHeaderRow } from '../examples/lib/xlsxBuilder.js';
import type { AbsenceRecord, AttendanceRecord } from '../src/index.js';

/** Ground truth captured from the reference spreadsheets (header labels only). */
const expected = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/expected-headers.json', import.meta.url)), 'utf8')
) as {
  attendance: { sheetName: string; headers: string[] };
  monthly: { sheetName: string; headers: string[] };
  absence: { sheetName: string; headers: string[] };
};

describe('Excel header equality with the reference format', () => {
  it('attendance headers and sheet name match the reference exactly (incl. NBSP/en-dash)', () => {
    expect(ATTENDANCE_HEADERS).toEqual(expected.attendance.headers);
    expect(ATTENDANCE_SHEET_NAME).toBe(expected.attendance.sheetName);
  });

  it('monthly view reuses the attendance headers and matches its reference sheet name', () => {
    expect(ATTENDANCE_HEADERS).toEqual(expected.monthly.headers);
    expect(MONTHLY_SHEET_NAME).toBe(expected.monthly.sheetName);
  });

  it('absence headers and sheet name match the reference exactly', () => {
    expect(ABSENCE_HEADERS).toEqual(expected.absence.headers);
    expect(ABSENCE_SHEET_NAME).toBe(expected.absence.sheetName);
  });

  it('verifies the special code points are NBSP (U+00A0) and en-dash (U+2013), not ASCII', () => {
    const codeHeader = ATTENDANCE_HEADERS[7]!; // "Anwesenheitsprojekt<NBSP><DASH> Code"
    expect(codeHeader).toContain(' ');
    expect(codeHeader).toContain('–');
    expect(codeHeader.includes('- Code')).toBe(false); // not a plain hyphen
  });

  it('a generated workbook round-trips the exact attendance header row', () => {
    const record: AttendanceRecord = {
      personId: 'p1', personnelNumber: '12345', lastName: 'Schmidt', firstName: 'Anna',
      customer: 'Acme', costCenter: '50101 Alten GmbH', project: 'Website Relaunch',
      projectCode: '25243-1', subProject: 'Parent', date: '2026-06-01', hours: 7.5,
      comment: 'x', billable: true, projectStart: '2026-01-01', projectEnd: '2026-12-31',
    };
    const range = { from: '2026-06-01', to: '2026-06-30' };
    const wb = buildSheetWorkbook(ATTENDANCE_SHEET_NAME, ATTENDANCE_HEADERS, [
      attendanceRow(record, range),
    ]);
    expect(readHeaderRow(wb)).toEqual([...ATTENDANCE_HEADERS]);
  });

  it('a generated absence workbook round-trips the exact absence header row', () => {
    const record: AbsenceRecord = {
      personId: 'p1', personnelNumber: '12345', preferredName: 'Anna S.', firstName: 'Anna',
      lastName: 'Schmidt', department: 'Engineering', absenceType: 'Urlaub',
      startDate: '2026-04-01', endDate: '2026-04-05', dailyAmount: 1, durationDays: 5,
      hourlyAmount: null, durationHours: null, comment: '', status: 'APPROVED',
      certificateStatus: '',
    };
    const range = { from: '2026-04-01', to: '2026-04-30' };
    const wb = buildSheetWorkbook(ABSENCE_SHEET_NAME, ABSENCE_HEADERS, [absenceRow(record, range)]);
    expect(readHeaderRow(wb)).toEqual([...ABSENCE_HEADERS]);
  });
});
