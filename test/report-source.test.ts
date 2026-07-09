import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import { ReportSource } from '../src/sources/report-source.js';
import { normalizeReport } from '../src/endpoints/reports.js';

const BASE = 'https://api.personio.test';

const server = setupServer(
  http.post(`${BASE}/v2/auth/token`, () =>
    HttpResponse.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new PersonioClient({ clientId: 'id', clientSecret: 'secret', baseUrl: BASE });
}

/**
 * Shape confirmed live against a real account on 2026-07-09 (see
 * OPEN_QUESTIONS.md): `GET /v2/reports/{id}` → `{ _data, _meta }`, `_meta.columns`
 * is `[{ name, display, type }]`, and each `_data` row is a positional array of
 * typed cell objects (`numeric_value` / `string_value` / `options_value`).
 * Content below is fabricated, not real employee data.
 */
const ATTENDANCE_REPORT_PAYLOAD = {
  report_config: { name: 'Anwesenheitszeiträume nach Kunde' },
  _meta: {
    columns: [
      { name: 'last_name', display: 'Last name (legal)', type: 'string' },
      { name: 'first_name', display: 'First name (legal)', type: 'string' },
      { name: 'attendance_project_client_name', display: 'Attendance Project Client Name', type: 'option' },
      { name: 'attendance_project_cost_center', display: 'Attendance Project Cost Center', type: 'option' },
      { name: 'attendance_project', display: 'Attendance Project', type: 'option' },
      { name: 'attendance_project_code', display: 'Attendance Project Code', type: 'option' },
      { name: 'attendance_subproject', display: 'Attendance Subproject', type: 'option' },
      { name: 'attendance_date', display: 'Attendance Date', type: 'timestamp' },
      { name: 'attendance_hours_tracked', display: 'Attendance Hours Tracked', type: 'decimal' },
      { name: 'attendance_comment', display: 'Attendance Comment', type: 'string' },
      { name: 'attendance_project_billable', display: 'Attendance Project Billable', type: 'option' },
      { name: 'attendance_project_start_date', display: 'Attendance Project Start Date', type: 'timestamp' },
      { name: 'attendance_project_end_date', display: 'Attendance Project End Date', type: 'timestamp' },
    ],
    links: null,
  },
  _data: [
    [
      { attribute_id: 'last_name', string_value: { value: 'Muster' } },
      { attribute_id: 'first_name', string_value: { value: 'Max' } },
      { attribute_id: 'attendance_project_client_name', options_value: { options: [{ key: 'ACME', value: 'ACME GmbH' }] } },
      { attribute_id: 'attendance_project_cost_center', options_value: { options: [{ key: '1001', value: '10000 ACME' }] } },
      { attribute_id: 'attendance_project', options_value: { options: [{ key: '5001', value: 'ACME Rollout' }] } },
      { attribute_id: 'attendance_project_code', options_value: { options: [{ key: '22001-1', value: '22001-1' }] } },
      { attribute_id: 'attendance_subproject', options_value: { options: [{ key: '5002', value: 'Implementierung' }] } },
      { attribute_id: 'attendance_date', string_value: { value: '2026-05-04' } },
      // Decimal hours as a real JS number — the case that previously got mangled
      // by the German-decimal-comma string parser (3.5 -> 35).
      { attribute_id: 'attendance_hours_tracked', numeric_value: { number: 3.5 } },
      { attribute_id: 'attendance_comment', string_value: { value: 'Kickoff' } },
      { attribute_id: 'attendance_project_billable', options_value: { options: [{ key: 'true', value: 'Yes' }] } },
      { attribute_id: 'attendance_project_start_date', string_value: { value: '2022-03-01' } },
      { attribute_id: 'attendance_project_end_date', string_value: { value: '2026-03-31' } },
    ],
  ],
};

describe('normalizeReport', () => {
  it('parses the verified Reporting v2 shape: _meta.columns + positional typed cells', () => {
    const data = normalizeReport(ATTENDANCE_REPORT_PAYLOAD);

    expect(data.columns.map((c) => c.id)).toContain('attendance_hours_tracked');
    expect(data.columns.find((c) => c.id === 'attendance_hours_tracked')).toEqual({
      id: 'attendance_hours_tracked',
      label: 'Attendance Hours Tracked',
      type: 'decimal',
    });

    expect(data.rows).toHaveLength(1);
    const [row] = data.rows;
    expect(row?.attendance_hours_tracked).toBe(3.5);
    expect(row?.attendance_project_client_name).toBe('ACME GmbH');
    expect(row?.attendance_project_billable).toBe('Yes');
  });
});

describe('ReportSource', () => {
  it('resolves attendance columns by id against the real Reporting v2 labels and keeps decimal hours intact', async () => {
    server.use(
      http.get(`${BASE}/v2/reports/rep-1`, () => HttpResponse.json(ATTENDANCE_REPORT_PAYLOAD))
    );

    const source = new ReportSource(makeClient(), { reportId: 'rep-1' });
    const records = await source.getAttendance({ from: '2026-01-01', to: '2026-12-31' });

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      personId: '',
      personnelNumber: '',
      lastName: 'Muster',
      firstName: 'Max',
      customer: 'ACME GmbH',
      costCenter: '10000 ACME',
      project: 'ACME Rollout',
      projectCode: '22001-1',
      subProject: 'Implementierung',
      date: '2026-05-04',
      hours: 3.5,
      comment: 'Kickoff',
      billable: true,
      projectStart: '2022-03-01',
      projectEnd: '2026-03-31',
    });
  });
});
