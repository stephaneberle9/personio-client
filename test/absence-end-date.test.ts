import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import { ApiSource, inclusiveEndDate } from '../src/sources/api-source.js';

// The `end` of a Personio day-tracked absence period is an EXCLUSIVE boundary at
// local midnight (the start of the day after the last absent day); the reference
// report shows the INCLUSIVE last day. `inclusiveEndDate` converts one to the
// other. Raw shapes below are the ones confirmed live against /v2/absence-periods
// and its per-day breakdown (see OPEN_QUESTIONS.md).
describe('inclusiveEndDate', () => {
  it('maps a single-day absence to the same day (midnight-exclusive → minus one)', () => {
    // starts_from 2026-04-02, ends_at 2026-04-03T00:00:00 → last absent day 2026-04-02
    expect(inclusiveEndDate('2026-04-03T00:00:00')).toBe('2026-04-02');
  });

  it('maps a multi-day absence to the last absent day', () => {
    // starts_from 2026-12-28, ends_at 2027-01-01T00:00:00 → last absent day 2026-12-31
    expect(inclusiveEndDate('2027-01-01T00:00:00')).toBe('2026-12-31');
  });

  it('crosses month and year boundaries via UTC date math', () => {
    expect(inclusiveEndDate('2026-05-01T00:00:00')).toBe('2026-04-30');
    expect(inclusiveEndDate('2027-01-01T00:00:00')).toBe('2026-12-31');
  });

  it('tolerates a trailing Z / fractional seconds on the midnight boundary', () => {
    expect(inclusiveEndDate('2026-04-03T00:00:00Z')).toBe('2026-04-02');
    expect(inclusiveEndDate('2026-04-03T00:00:00.000Z')).toBe('2026-04-02');
  });

  it('keeps the same day for an hour-tracked absence (non-midnight time)', () => {
    // Docs example: hour-tracked periods carry a real time-of-day and end same day.
    expect(inclusiveEndDate('2024-04-01T14:00:00')).toBe('2024-04-01');
  });

  it('treats a bare date as already inclusive', () => {
    expect(inclusiveEndDate('2026-04-02')).toBe('2026-04-02');
  });

  it('returns null for an open-ended absence', () => {
    expect(inclusiveEndDate(null)).toBeNull();
    expect(inclusiveEndDate(undefined)).toBeNull();
    expect(inclusiveEndDate('')).toBeNull();
  });
});

// End-to-end through the source: the domain record must carry the inclusive end.
const BASE = 'https://api.personio.test';
const persons = [{ id: 'p1', first_name: 'Anna', last_name: 'Schmidt' }];
const absenceTypes = [{ id: 't1', name: 'Urlaub' }];
const absencePeriods = [
  // single day
  {
    id: 'x1', person: { id: 'p1' }, absence_type: { id: 't1' },
    starts_from: { date_time: '2026-06-05T00:00:00', type: 'FIRST_HALF' },
    ends_at: { date_time: '2026-06-06T00:00:00', type: 'SECOND_HALF' },
    comment: '', approval: { status: 'APPROVED' },
  },
  // multi day
  {
    id: 'x2', person: { id: 'p1' }, absence_type: { id: 't1' },
    starts_from: { date_time: '2026-06-10T00:00:00', type: 'FIRST_HALF' },
    ends_at: { date_time: '2026-06-13T00:00:00', type: 'SECOND_HALF' },
    comment: '', approval: { status: 'APPROVED' },
  },
  // open-ended
  {
    id: 'x3', person: { id: 'p1' }, absence_type: { id: 't1' },
    starts_from: { date_time: '2026-06-20T00:00:00', type: 'FIRST_HALF' },
    ends_at: null, comment: '', approval: { status: 'APPROVED' },
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

describe('ApiSource absence end date', () => {
  it('carries the inclusive report end date, not the exclusive API boundary', async () => {
    const source = new ApiSource(
      new PersonioClient({ clientId: 'id', clientSecret: 'secret', baseUrl: BASE })
    );
    const records = await source.getAbsence({ from: '2026-06-01', to: '2026-06-30' });
    const byId = Object.fromEntries(records.map((r) => [r.personId + r.startDate, r]));
    expect(byId['p12026-06-05T00:00:00']!.endDate).toBe('2026-06-05');
    expect(byId['p12026-06-10T00:00:00']!.endDate).toBe('2026-06-12');
    expect(byId['p12026-06-20T00:00:00']!.endDate).toBeNull();
  });
});
