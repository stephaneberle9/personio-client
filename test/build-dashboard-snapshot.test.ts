import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import { buildSnapshot } from '../examples/lib/snapshotBuilder.js';

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
  http.get(`${BASE}/v2/cost-centers`, () => HttpResponse.json({ _data: costCenters }))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new PersonioClient({ clientId: 'id', clientSecret: 'secret', baseUrl: BASE });
}

describe('buildSnapshot', () => {
  it('builds dashboard records plus an audit meta block from the api source', async () => {
    const { records, meta } = await buildSnapshot({
      from: '2026-06-01',
      to: '2026-06-30',
      source: 'api',
      client: makeClient(),
    });

    expect(records).toEqual([
      {
        datum: '2026-06-01',
        ma: 'Schmidt, Anna',
        kunde: 'Acme',
        kst: '50101 Alten GmbH',
        projekt: 'Website Relaunch',
        up: '',
        std: 4,
        kommentar: 'Did stuff',
        startdatum: '2026-01-01',
        enddatum: '2026-12-31',
      },
    ]);
    expect(meta).toMatchObject({
      from: '2026-06-01',
      to: '2026-06-30',
      source: 'api',
      reportId: null,
      count: 1,
    });
    // generatedAt is a valid ISO timestamp.
    expect(Number.isNaN(Date.parse(meta.generatedAt))).toBe(false);
  });

  it('never records a reportId in the audit trail for an api-source pull', async () => {
    // A leftover reportId must not leak into an api-source snapshot's meta.
    const { meta } = await buildSnapshot({
      from: '2026-06-01',
      to: '2026-06-30',
      source: 'api',
      reportId: 'leftover-report-id',
      client: makeClient(),
    });
    expect(meta.reportId).toBeNull();
  });

  it('applies the optional cost-center pre-filter', async () => {
    const { records, meta } = await buildSnapshot({
      from: '2026-06-01',
      to: '2026-06-30',
      source: 'api',
      costCenters: ['99999'],
      client: makeClient(),
    });
    expect(records).toHaveLength(0);
    expect(meta.count).toBe(0);
  });
});
