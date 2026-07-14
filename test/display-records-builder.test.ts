import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import {
  buildAttendanceDisplayRecords,
  buildAbsenceDisplayRecords,
} from '../examples/lib/displayRecordsBuilder.js';

const BASE = 'https://api.personio.test';

const persons = [{ id: 'p1', first_name: 'Anna', last_name: 'Schmidt' }];
const projects = [
  {
    id: 'prj1',
    name: 'Website Relaunch',
    start: { date: '2026-01-01' },
    end: { date: '2026-12-31' },
    client_name: 'Acme',
    cost_center: { id: 'cc1' },
    billable: true,
  },
];
const costCenters = [{ id: 'cc1', name: '50101 Alten GmbH' }];
const absenceTypes = [{ id: 't1', name: 'Vacation', category: 'PAID', unit: 'DAY' }];
const absencePeriods = [
  {
    id: 'ab1', person: { id: 'p1' },
    starts_from: { date_time: '2026-06-10T00:00:00Z' },
    ends_at: { date_time: '2026-06-12T00:00:00Z' },
    absence_type: { id: 't1' }, approval: { status: 'APPROVED' }, comment: 'Trip',
  },
];
const breakdowns = [
  { date: '2026-06-10', effective_duration: { unit: 'DAY', value: 1 } },
  { date: '2026-06-11', effective_duration: { unit: 'DAY', value: 1 } },
];
const periods = [
  {
    id: 'a1', type: 'WORK', person: { id: 'p1' }, project: { id: 'prj1' },
    attribution_date: '2026-06-01',
    start: { date_time: '2026-06-01T08:00:00' }, end: { date_time: '2026-06-01T12:00:00' },
    comment: 'Did stuff',
  },
];

const server = setupServer(
  http.post(`${BASE}/v2/auth/token`, () =>
    HttpResponse.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
  ),
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
  http.get(`${BASE}/v2/cost-centers`, () => HttpResponse.json({ _data: costCenters })),
  http.get(`${BASE}/v2/absence-periods`, () => HttpResponse.json({ _data: absencePeriods })),
  http.get(`${BASE}/v2/absence-types`, () => HttpResponse.json({ _data: absenceTypes })),
  http.get(`${BASE}/v2/absence-periods/:id/breakdowns`, () =>
    HttpResponse.json({ _data: breakdowns })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new PersonioClient({ clientId: 'id', clientSecret: 'secret', baseUrl: BASE });
}

describe('buildAttendanceDisplayRecords', () => {
  it('builds English attendance display records from the api source', async () => {
    const records = await buildAttendanceDisplayRecords({
      from: '2026-06-01',
      to: '2026-06-30',
      source: 'api',
      client: makeClient(),
    });

    expect(records).toEqual([
      {
        date: '2026-06-01',
        employee: 'Schmidt, Anna',
        customer: 'Acme',
        costCenter: '50101 Alten GmbH',
        project: 'Website Relaunch',
        subProject: '',
        hours: 4,
        comment: 'Did stuff',
        projectStart: '2026-01-01',
        projectEnd: '2026-12-31',
      },
    ]);
  });

  it('applies the optional cost-center pre-filter', async () => {
    const records = await buildAttendanceDisplayRecords({
      from: '2026-06-01',
      to: '2026-06-30',
      source: 'api',
      costCenters: ['99999'],
      client: makeClient(),
    });
    expect(records).toHaveLength(0);
  });
});

describe('buildAbsenceDisplayRecords', () => {
  it('builds English absence display records with days resolved from breakdowns', async () => {
    const records = await buildAbsenceDisplayRecords({
      from: '2026-06-01', to: '2026-06-30', source: 'api', client: makeClient(),
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      startDate: '2026-06-10', employee: 'Schmidt, Anna', department: '',
      type: 'Vacation', days: 2, status: 'APPROVED',
    });
    expect(records[0]!.endDate).toMatch(/^2026-06-\d{2}$/);
  });
});
