import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import { ApiSource } from '../src/sources/api-source.js';

const BASE = 'https://api.personio.test';

const persons = [
  { id: 'p1', first_name: 'Anna', last_name: 'Schmidt', preferred_name: 'Anna S.' },
  { id: 'p2', first_name: 'Ben', last_name: 'Müller', preferred_name: 'Ben M.' },
];

const absenceTypes = [{ id: 't1', name: 'Urlaub' }];

const absencePeriods = [
  {
    id: 'x1', person: { id: 'p1' }, absence_type: { id: 't1' },
    starts_from: { date_time: '2026-06-01T00:00:00Z' }, ends_at: { date_time: '2026-06-03T00:00:00Z' },
    comment: '', approval: { status: 'APPROVED' },
  },
  {
    id: 'x2', person: { id: 'p2' }, absence_type: { id: 't1' },
    starts_from: { date_time: '2026-06-05T00:00:00Z' }, ends_at: { date_time: '2026-06-05T00:00:00Z' },
    comment: '', approval: { status: 'APPROVED' },
  },
];

// x1 is a multi-day DAY absence with one entry falling OUTSIDE the queried
// range (2026-07-01) that must be excluded from the sum. x2 is an HOUR absence.
const breakdownsById: Record<string, unknown[]> = {
  x1: [
    { date: '2026-06-01', effective_duration: { unit: 'DAY', value: 1 } },
    { date: '2026-06-02', effective_duration: { unit: 'DAY', value: 0.5 } },
    { date: '2026-07-01', effective_duration: { unit: 'DAY', value: 1 } },
  ],
  x2: [
    { date: '2026-06-05', effective_duration: { unit: 'HOUR', value: 4 } },
    { date: '2026-06-05', effective_duration: { unit: 'HOUR', value: 3.5 } },
  ],
};

const server = setupServer(
  http.post(`${BASE}/v2/auth/token`, () =>
    HttpResponse.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
  ),
  http.get(`${BASE}/v2/absence-periods/:id/breakdowns`, ({ params }) =>
    HttpResponse.json({ _data: breakdownsById[params.id as string] ?? [] })
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

function byLastName<T extends { lastName: string }>(records: T[]): Record<string, T> {
  return Object.fromEntries(records.map((r) => [r.lastName, r]));
}

describe('ApiSource absence breakdown fetch', () => {
  it('leaves all amount fields null when the flag is off (default)', async () => {
    const source = new ApiSource(makeClient());
    const records = byLastName(await source.getAbsence(range));
    for (const r of Object.values(records)) {
      expect(r.dailyAmount).toBeNull();
      expect(r.durationDays).toBeNull();
      expect(r.hourlyAmount).toBeNull();
      expect(r.durationHours).toBeNull();
    }
  });

  it('sums DAY entries into dailyAmount/durationDays, excluding out-of-range dates', async () => {
    const source = new ApiSource(makeClient(), { fetchAbsenceBreakdowns: true });
    const records = byLastName(await source.getAbsence(range));
    // 1 + 0.5 in range; the 2026-07-01 entry is excluded.
    expect(records['Schmidt']!.dailyAmount).toBe(1.5);
    expect(records['Schmidt']!.durationDays).toBe(1.5);
    // No HOUR entries for this period → hour fields stay null.
    expect(records['Schmidt']!.hourlyAmount).toBeNull();
    expect(records['Schmidt']!.durationHours).toBeNull();
  });

  it('sums HOUR entries into hourlyAmount/durationHours', async () => {
    const source = new ApiSource(makeClient(), { fetchAbsenceBreakdowns: true });
    const records = byLastName(await source.getAbsence(range));
    // 4 + 3.5 hours.
    expect(records['Müller']!.hourlyAmount).toBe(7.5);
    expect(records['Müller']!.durationHours).toBe(7.5);
    // No DAY entries for this period → day fields stay null.
    expect(records['Müller']!.dailyAmount).toBeNull();
    expect(records['Müller']!.durationDays).toBeNull();
  });
});
