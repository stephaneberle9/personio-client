import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import { ReportSource } from '../src/sources/report-source.js';

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
 * Minimal absence report carrying the **English title-case** option labels the
 * Reporting-v2 read returns for the status column ("Approved", "Pending", …) —
 * the case the localization must normalize to the raw enum key before mapping.
 * One row uses an English label with no map entry (must pass through), and one
 * carries the already-raw enum form ("APPROVED") to prove enum input resolves
 * to the same entry as the English label.
 */
const ABSENCE_REPORT_PAYLOAD = {
  report_config: { name: 'Abwesenheiten seit April 2026' },
  _meta: {
    columns: [
      { name: 'last_name', display: 'Last name (legal)', type: 'string' },
      { name: 'absence_type', display: 'Absence Type', type: 'option' },
      { name: 'absence_period_start', display: 'Absence Period Start', type: 'timestamp' },
      { name: 'absence_period_status', display: 'Absence Period Status', type: 'option' },
    ],
    links: null,
  },
  _data: [
    [
      { attribute_id: 'last_name', string_value: { value: 'Schmidt' } },
      { attribute_id: 'absence_type', options_value: { options: [{ key: 'u', value: 'Urlaub' }] } },
      { attribute_id: 'absence_period_start', string_value: { value: '2026-06-01' } },
      // English title-case label, as the Reporting-v2 read delivers it.
      { attribute_id: 'absence_period_status', options_value: { options: [{ key: 'APPROVED', value: 'Approved' }] } },
    ],
    [
      { attribute_id: 'last_name', string_value: { value: 'Müller' } },
      { attribute_id: 'absence_type', options_value: { options: [{ key: 'u', value: 'Urlaub' }] } },
      { attribute_id: 'absence_period_start', string_value: { value: '2026-06-05' } },
      { attribute_id: 'absence_period_status', options_value: { options: [{ key: 'PENDING', value: 'Pending' }] } },
    ],
    [
      { attribute_id: 'last_name', string_value: { value: 'Weiß' } },
      { attribute_id: 'absence_type', options_value: { options: [{ key: 'u', value: 'Urlaub' }] } },
      { attribute_id: 'absence_period_start', string_value: { value: '2026-06-10' } },
      // No entry in the label map → must pass through unchanged.
      { attribute_id: 'absence_period_status', options_value: { options: [{ key: 'CANCELLED', value: 'Cancelled' }] } },
    ],
    [
      { attribute_id: 'last_name', string_value: { value: 'Fischer' } },
      { attribute_id: 'absence_type', options_value: { options: [{ key: 'u', value: 'Urlaub' }] } },
      { attribute_id: 'absence_period_start', string_value: { value: '2026-06-12' } },
      // Already the raw enum form — must resolve to the same entry as "Approved".
      { attribute_id: 'absence_period_status', string_value: { value: 'APPROVED' } },
    ],
  ],
};

const STATUS_LABELS = { APPROVED: 'Genehmigt', PENDING: 'Ausstehend', REJECTED: 'Abgelehnt' };
const range = { from: '2026-06-01', to: '2026-06-30' };

function statusByLastName(records: { lastName: string; status: string }[]): Record<string, string> {
  return Object.fromEntries(records.map((r) => [r.lastName, r.status]));
}

describe('ReportSource status label localization', () => {
  it('maps an English label that has an entry in statusLabels', async () => {
    server.use(
      http.get(`${BASE}/v2/reports/rep-1`, () => HttpResponse.json(ABSENCE_REPORT_PAYLOAD))
    );
    const source = new ReportSource(makeClient(), { reportId: 'rep-1', statusLabels: STATUS_LABELS });
    const status = statusByLastName(await source.getAbsence(range));
    expect(status['Schmidt']).toBe('Genehmigt');
    expect(status['Müller']).toBe('Ausstehend');
  });

  it('resolves the raw enum form to the same entry as the English label', async () => {
    server.use(
      http.get(`${BASE}/v2/reports/rep-1`, () => HttpResponse.json(ABSENCE_REPORT_PAYLOAD))
    );
    const source = new ReportSource(makeClient(), { reportId: 'rep-1', statusLabels: STATUS_LABELS });
    const status = statusByLastName(await source.getAbsence(range));
    // "Approved" (English label) and "APPROVED" (enum) both localize identically.
    expect(status['Fischer']).toBe('Genehmigt');
  });

  it('passes an unmapped status value through unchanged', async () => {
    server.use(
      http.get(`${BASE}/v2/reports/rep-1`, () => HttpResponse.json(ABSENCE_REPORT_PAYLOAD))
    );
    const source = new ReportSource(makeClient(), { reportId: 'rep-1', statusLabels: STATUS_LABELS });
    const status = statusByLastName(await source.getAbsence(range));
    // 'Cancelled' has no entry → the raw report label is preserved verbatim.
    expect(status['Weiß']).toBe('Cancelled');
  });

  it('keeps the raw report label when the option is absent (byte-identical default)', async () => {
    server.use(
      http.get(`${BASE}/v2/reports/rep-1`, () => HttpResponse.json(ABSENCE_REPORT_PAYLOAD))
    );
    const source = new ReportSource(makeClient(), { reportId: 'rep-1' });
    const status = statusByLastName(await source.getAbsence(range));
    expect(status).toEqual({
      Schmidt: 'Approved',
      Müller: 'Pending',
      Weiß: 'Cancelled',
      Fischer: 'APPROVED',
    });
  });
});
