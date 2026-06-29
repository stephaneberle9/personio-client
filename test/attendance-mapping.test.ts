import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import { ApiSource } from '../src/sources/api-source.js';
import { AttendanceService } from '../src/domain/attendance-service.js';
import { toDashboardRecord } from '../examples/lib/dashboard.js';

const BASE = 'https://api.personio.test';

const persons = [
  {
    id: 'p1',
    first_name: 'Anna',
    last_name: 'Schmidt',
    preferred_name: 'Anna S.',
    personnel_number: '71181',
    department: 'Engineering',
  },
];

const projects = [
  {
    id: 'prj0',
    name: 'Parent Program',
  },
  {
    id: 'prj1',
    name: 'Website Relaunch',
    code: '25243-1',
    parent_project: { id: 'prj0' },
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    customer: 'Acme',
    cost_center: '50101 Alten GmbH',
    billable: true,
  },
];

const periods = [
  // Two WORK periods, same person+date+project → summed.
  {
    id: 'a1', type: 'WORK', person: { id: 'p1' }, project: { id: 'prj1' },
    attribution_date: '2026-06-01',
    start: { date_time: '2026-06-01T08:00:00' }, end: { date_time: '2026-06-01T12:00:00' },
    comment: '',
  },
  {
    id: 'a2', type: 'WORK', person: { id: 'p1' }, project: { id: 'prj1' },
    attribution_date: '2026-06-01',
    start: { date_time: '2026-06-01T13:00:00' }, end: { date_time: '2026-06-01T17:00:00' },
    comment: 'Did stuff',
  },
  // A BREAK in the same group → subtracted (0.5h).
  {
    id: 'b1', type: 'BREAK', person: { id: 'p1' }, project: { id: 'prj1' },
    attribution_date: '2026-06-01',
    start: { date_time: '2026-06-01T12:00:00' }, end: { date_time: '2026-06-01T12:30:00' },
  },
  // A period crossing midnight, grouped by its attribution_date (2026-06-02).
  {
    id: 'a3', type: 'WORK', person: { id: 'p1' }, project: { id: 'prj1' },
    attribution_date: '2026-06-02',
    start: { date_time: '2026-06-02T22:00:00' }, end: { date_time: '2026-06-03T02:00:00' },
    comment: 'Night shift',
  },
];

const server = setupServer(
  http.post(`${BASE}/v2/auth/token`, () =>
    HttpResponse.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
  ),
  http.get(`${BASE}/v2/attendance-periods`, () => HttpResponse.json({ _data: periods })),
  http.get(`${BASE}/v2/projects`, () => HttpResponse.json({ _data: projects })),
  http.get(`${BASE}/v2/persons`, () => HttpResponse.json({ _data: persons }))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new PersonioClient({ clientId: 'id', clientSecret: 'secret', baseUrl: BASE });
}

describe('ApiSource attendance mapping', () => {
  it('joins persons/projects, sums WORK minus BREAK, and groups by attribution_date', async () => {
    const service = new AttendanceService(new ApiSource(makeClient()));
    const records = await service.getRecords({ from: '2026-06-01', to: '2026-06-30' });

    expect(records).toHaveLength(2);

    const [day1, day2] = records;
    expect(day1).toMatchObject({
      date: '2026-06-01',
      hours: 7.5, // 8h work − 0.5h break
      personnelNumber: '71181',
      lastName: 'Schmidt',
      firstName: 'Anna',
      customer: 'Acme',
      costCenter: '50101 Alten GmbH',
      project: 'Website Relaunch',
      projectCode: '25243-1',
      subProject: 'Parent Program',
      billable: true,
      projectStart: '2026-01-01',
      projectEnd: '2026-12-31',
      comment: 'Did stuff', // first non-empty comment in the group
    });

    // Midnight-crossing period attributed to 2026-06-02, full 4h.
    expect(day2).toMatchObject({ date: '2026-06-02', hours: 4 });
  });

  it('maps an AttendanceRecord to the dashboard record format', async () => {
    const service = new AttendanceService(new ApiSource(makeClient()));
    const [record] = await service.getRecords({ from: '2026-06-01', to: '2026-06-30' });

    expect(toDashboardRecord(record!)).toEqual({
      datum: '2026-06-01',
      ma: 'Schmidt, Anna',
      kunde: 'Acme',
      kst: '50101 Alten GmbH',
      projekt: 'Website Relaunch',
      up: 'Parent Program',
      std: 7.5,
      kommentar: 'Did stuff',
      startdatum: '2026-01-01',
      enddatum: '2026-12-31',
    });
  });

  it('applies the optional cost-center pre-filter', async () => {
    const service = new AttendanceService(new ApiSource(makeClient()));
    const none = await service.getRecords({
      from: '2026-06-01', to: '2026-06-30', costCenters: ['99999'],
    });
    expect(none).toHaveLength(0);

    const some = await service.getRecords({
      from: '2026-06-01', to: '2026-06-30', costCenters: ['50101'],
    });
    expect(some).toHaveLength(2);
  });
});
