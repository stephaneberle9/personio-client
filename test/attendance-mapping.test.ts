import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import { ApiSource } from '../src/sources/api-source.js';
import { AttendanceService } from '../src/domain/attendance-service.js';
import { toDashboardRecord } from '../examples/lib/dashboard.js';

const BASE = 'https://api.personio.test';

// Real v2 person shape: the personnel number ("Kostenträger Nummer") is a
// custom attribute in `custom_attributes[]`, keyed by an opaque id, not a flat
// `personnel_number` field.
const persons = [
  {
    id: 'p1',
    first_name: 'Anna',
    last_name: 'Schmidt',
    preferred_name: 'Anna S.',
    custom_attributes: [
      { global_id: '9999999', id: 'dynamic_1234567890abcd.12345678', type: 'int', value: 12345 },
    ],
  },
];

// Real v2 project shape (verified against a live account): `project_code`,
// `client_name`, a `cost_center: { id }` reference, and `{ date }` wrappers.
const projects = [
  {
    id: 'prj0',
    name: 'Parent Program',
  },
  {
    id: 'prj1',
    name: 'Website Relaunch',
    project_code: '25243-1',
    parent_project: { id: 'prj0' },
    start: { date: '2026-01-01' },
    end: { date: '2026-12-31' },
    client_name: 'Acme',
    cost_center: { id: 'cc1' },
    billable: true,
  },
];

// /v2/cost-centers maps the project's cost_center id to its display name.
const costCenters = [{ id: 'cc1', name: '50101 Alten GmbH' }];

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
  // Filter by the attribution_date window so the parallel sub-range fetch (which
  // splits the range into several dated queries) reassembles to the same set.
  http.get(`${BASE}/v2/attendance-periods`, ({ request }) => {
    const url = new URL(request.url);
    const gte = url.searchParams.get('attribution_date.gte');
    const lte = url.searchParams.get('attribution_date.lte');
    const data = periods.filter(
      (p) => (!gte || p.attribution_date >= gte) && (!lte || p.attribution_date <= lte)
    );
    return HttpResponse.json({ _data: data });
  }),
  http.get(`${BASE}/v2/projects`, () => HttpResponse.json({ _data: projects })),
  http.get(`${BASE}/v2/persons`, () => HttpResponse.json({ _data: persons })),
  http.get(`${BASE}/v2/cost-centers`, () => HttpResponse.json({ _data: costCenters }))
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
      personnelNumber: '12345',
      lastName: 'Schmidt',
      firstName: 'Anna',
      customer: 'Acme',
      costCenter: '50101 Alten GmbH',
      // The booked project (prj1) is a sub-project; the report shows its
      // top-level ancestor (prj0) as the main project and prj1 as the sub.
      project: 'Parent Program',
      projectCode: '25243-1',
      subProject: 'Website Relaunch',
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
      projekt: 'Parent Program',
      up: 'Website Relaunch',
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
