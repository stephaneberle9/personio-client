import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import { ApiSource } from '../src/sources/api-source.js';

const BASE = 'https://api.personio.test';

const persons = [
  { id: 'p1', first_name: 'Anna', last_name: 'Schmidt', preferred_name: 'Anna S.' },
  { id: 'p2', first_name: 'Ben', last_name: 'Müller', preferred_name: 'Ben M.' },
  { id: 'p3', first_name: 'Carla', last_name: 'Weiß', preferred_name: 'Carla W.' },
];

const absenceTypes = [{ id: 't1', name: 'Urlaub' }];

// Three absences carrying the raw v2 approval enums the API returns.
const absencePeriods = [
  {
    id: 'x1', person: { id: 'p1' }, absence_type: { id: 't1' },
    starts_from: { date_time: '2026-06-01T00:00:00Z' }, ends_at: { date_time: '2026-06-03T00:00:00Z' },
    comment: '', approval: { status: 'APPROVED' },
  },
  {
    id: 'x2', person: { id: 'p2' }, absence_type: { id: 't1' },
    starts_from: { date_time: '2026-06-05T00:00:00Z' }, ends_at: { date_time: '2026-06-06T00:00:00Z' },
    comment: '', approval: { status: 'PENDING' },
  },
  // An enum with no mapping in the localization table → must pass through raw.
  {
    id: 'x3', person: { id: 'p3' }, absence_type: { id: 't1' },
    starts_from: { date_time: '2026-06-10T00:00:00Z' }, ends_at: { date_time: '2026-06-11T00:00:00Z' },
    comment: '', approval: { status: 'CANCELLED' },
  },
];

const server = setupServer(
  http.post(`${BASE}/v2/auth/token`, () =>
    HttpResponse.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
  ),
  http.get(`${BASE}/v2/absence-periods`, () => HttpResponse.json({ _data: absencePeriods })),
  http.get(`${BASE}/v2/absence-types`, () => HttpResponse.json({ _data: absenceTypes })),
  http.get(`${BASE}/v2/persons`, () => HttpResponse.json({ _data: persons }))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new PersonioClient({ clientId: 'id', clientSecret: 'secret', baseUrl: BASE });
}

const range = { from: '2026-06-01', to: '2026-06-30' };

// Records are sorted by startDate; index them by person for readable assertions.
function statusByLastName(records: { lastName: string; status: string }[]): Record<string, string> {
  return Object.fromEntries(records.map((r) => [r.lastName, r.status]));
}

describe('ApiSource status label localization', () => {
  it('maps a status that has an entry in statusLabels', async () => {
    const source = new ApiSource(makeClient(), {
      statusLabels: { APPROVED: 'Genehmigt', PENDING: 'Ausstehend', REJECTED: 'Abgelehnt' },
    });
    const records = await source.getAbsence(range);
    expect(statusByLastName(records)['Schmidt']).toBe('Genehmigt');
    expect(statusByLastName(records)['Müller']).toBe('Ausstehend');
  });

  it('passes an unmapped status value through unchanged', async () => {
    const source = new ApiSource(makeClient(), {
      statusLabels: { APPROVED: 'Genehmigt', PENDING: 'Ausstehend', REJECTED: 'Abgelehnt' },
    });
    const records = await source.getAbsence(range);
    // 'CANCELLED' has no entry → the raw enum is preserved.
    expect(statusByLastName(records)['Weiß']).toBe('CANCELLED');
  });

  it('leaves statuses as the raw enum when the option is absent (byte-identical default)', async () => {
    const source = new ApiSource(makeClient());
    const records = await source.getAbsence(range);
    expect(statusByLastName(records)).toEqual({
      Schmidt: 'APPROVED',
      Müller: 'PENDING',
      Weiß: 'CANCELLED',
    });
  });
});
