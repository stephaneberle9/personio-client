import { describe, expect, it, vi } from 'vitest';
import { PersonioApiError } from '../src/errors.js';
import {
  handleAttendanceRequest,
  handleAbsencesRequest,
  type AttendanceRecordsBuilder,
  type AbsenceRecordsBuilder,
} from '../examples/lib/dashboardHandler.js';
import type {
  AttendanceDisplayRecord,
  AbsenceDisplayRecord,
} from '../examples/lib/model/displayRecords.js';

const attendanceRecords: AttendanceDisplayRecord[] = [
  {
    date: '2026-06-01', employee: 'Schmidt, Anna', customer: 'Acme', costCenter: '1001',
    project: 'Website', subProject: '', hours: 7.5, comment: '', projectStart: '', projectEnd: '',
  },
];

const absenceRecords: AbsenceDisplayRecord[] = [
  {
    startDate: '2026-06-10', endDate: '2026-06-12', employee: 'Schmidt, Anna',
    department: 'Engineering', type: 'Vacation', days: 2, status: 'APPROVED',
  },
];

const query = (qs: string): URLSearchParams => new URLSearchParams(qs);

describe('handleAttendanceRequest', () => {
  it('returns the records as JSON on success and fires onSuccess', async () => {
    const build: AttendanceRecordsBuilder = vi.fn(async () => attendanceRecords);
    const onSuccess = vi.fn();

    const result = await handleAttendanceRequest(
      query('from=2026-06-01&to=2026-06-30&source=api'),
      {},
      { build, onSuccess }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ records: attendanceRecords });
    expect(onSuccess).toHaveBeenCalledWith(attendanceRecords, { source: 'api' });
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-06-01', to: '2026-06-30', source: 'api' })
    );
  });

  it('rejects a request missing from/to with a 400 and never calls build', async () => {
    const build: AttendanceRecordsBuilder = vi.fn(async () => attendanceRecords);
    const result = await handleAttendanceRequest(query('from=2026-06-01'), {}, { build });
    expect(result.status).toBe(400);
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects an invalid source with a 400', async () => {
    const build: AttendanceRecordsBuilder = vi.fn(async () => attendanceRecords);
    const result = await handleAttendanceRequest(
      query('from=2026-06-01&to=2026-06-30&source=bogus'),
      {},
      { build }
    );
    expect(result.status).toBe(400);
    expect(build).not.toHaveBeenCalled();
  });

  it('defaults the source to report when the attendance report id is set, else api', async () => {
    const build: AttendanceRecordsBuilder = vi.fn(async () => attendanceRecords);

    await handleAttendanceRequest(
      query('from=2026-06-01&to=2026-06-30'),
      { attendanceReportId: 'att-1' },
      { build }
    );
    expect(build).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'report', reportId: 'att-1' })
    );

    await handleAttendanceRequest(query('from=2026-06-01&to=2026-06-30'), {}, { build });
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'api' }));
  });

  it('ignores the absence report id — attendance uses only its own', async () => {
    const build: AttendanceRecordsBuilder = vi.fn(async () => attendanceRecords);
    // Only the absence id is configured; attendance must still default to api.
    await handleAttendanceRequest(
      query('from=2026-06-01&to=2026-06-30'),
      { absenceReportId: 'abs-1' },
      { build }
    );
    expect(build).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'api', reportId: undefined })
    );
  });

  it('surfaces a PersonioApiError as JSON with its upstream status and hint', async () => {
    const build: AttendanceRecordsBuilder = vi.fn(async () => {
      throw new PersonioApiError('Personio API error (401) on /v2/persons: Unauthorized. …hint…', {
        status: 401,
        path: '/v2/persons',
      });
    });

    const result = await handleAttendanceRequest(
      query('from=2026-06-01&to=2026-06-30&source=api'),
      {},
      { build }
    );

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({
      error: expect.stringContaining('/v2/persons'),
      status: 401,
      path: '/v2/persons',
    });
  });

  it('maps an unexpected error to a 500 with just the message', async () => {
    const build: AttendanceRecordsBuilder = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const result = await handleAttendanceRequest(
      query('from=2026-06-01&to=2026-06-30'),
      {},
      { build }
    );
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'socket hang up' });
  });
});

describe('handleAbsencesRequest', () => {
  it('returns the records as JSON on success and fires onSuccess', async () => {
    const build: AbsenceRecordsBuilder = vi.fn(async () => absenceRecords);
    const onSuccess = vi.fn();

    const result = await handleAbsencesRequest(
      query('from=2026-06-01&to=2026-06-30&source=api'),
      {},
      { build, onSuccess }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ records: absenceRecords });
    expect(onSuccess).toHaveBeenCalledWith(absenceRecords, { source: 'api' });
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-06-01', to: '2026-06-30', source: 'api' })
    );
  });

  it('rejects a request missing from/to with a 400 and never calls build', async () => {
    const build: AbsenceRecordsBuilder = vi.fn(async () => absenceRecords);
    const result = await handleAbsencesRequest(query('from=2026-06-01'), {}, { build });
    expect(result.status).toBe(400);
    expect(build).not.toHaveBeenCalled();
  });

  it('uses only the absence report id — an attendance id does not make it a report pull', async () => {
    const build: AbsenceRecordsBuilder = vi.fn(async () => absenceRecords);

    await handleAbsencesRequest(
      query('from=2026-06-01&to=2026-06-30'),
      { absenceReportId: 'abs-1' },
      { build }
    );
    expect(build).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'report', reportId: 'abs-1' })
    );

    // Only the attendance id set → absences must fall back to api.
    await handleAbsencesRequest(
      query('from=2026-06-01&to=2026-06-30'),
      { attendanceReportId: 'att-1' },
      { build }
    );
    expect(build).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'api', reportId: undefined })
    );
  });

  it('surfaces a PersonioApiError as JSON with its upstream status and hint', async () => {
    const build: AbsenceRecordsBuilder = vi.fn(async () => {
      throw new PersonioApiError(
        'Personio API error (403) on /v2/absence-periods: Forbidden. …hint…',
        { status: 403, path: '/v2/absence-periods' }
      );
    });

    const result = await handleAbsencesRequest(
      query('from=2026-06-01&to=2026-06-30&source=api'),
      {},
      { build }
    );

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      error: expect.stringContaining('/v2/absence-periods'),
      status: 403,
      path: '/v2/absence-periods',
    });
  });
});
