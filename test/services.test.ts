import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';
import { PersonService } from '../src/domain/person-service.js';
import { RecruitingService } from '../src/domain/recruiting-service.js';

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

describe('PersonService', () => {
  it('normalizes persons and resolves account-specific custom fields', async () => {
    server.use(
      http.get(`${BASE}/v2/persons`, () =>
        HttpResponse.json({
          _data: [
            {
              id: 'p1',
              first_name: 'Anna',
              last_name: 'Schmidt',
              email: 'anna@example.com',
              personnel_number: '12345',
              department: 'Engineering',
            },
          ],
        })
      )
    );

    const records = await new PersonService(makeClient()).getRecords();
    expect(records[0]).toEqual({
      id: 'p1',
      firstName: 'Anna',
      lastName: 'Schmidt',
      preferredName: '',
      email: 'anna@example.com',
      department: 'Engineering',
      personnelNumber: '12345',
    });
  });

  it('resolves the personnel number from the v2 custom_attributes array', async () => {
    server.use(
      http.get(`${BASE}/v2/persons`, () =>
        HttpResponse.json({
          _data: [
            {
              id: 'p1',
              first_name: 'Anna',
              last_name: 'Schmidt',
              email: 'anna@example.com',
              // Real /v2/persons shape: custom fields arrive as an array keyed
              // by opaque id, with no human label — matched by id slug.
              custom_attributes: [
                { global_id: '99297', id: 'city', type: 'string', value: 'Essen' },
                {
                  global_id: '9999999',
                  id: 'dynamic_1234567890abcd.12345678',
                  type: 'int',
                  value: 12345,
                },
              ],
            },
          ],
        })
      )
    );

    const records = await new PersonService(makeClient()).getRecords();
    expect(records[0]).toMatchObject({
      firstName: 'Anna',
      lastName: 'Schmidt',
      personnelNumber: '12345',
      // Department is not on /v2/persons (it lives on the employment's org
      // units, id-only), so it resolves to empty here.
      department: '',
    });
  });
});

describe('RecruitingService', () => {
  it('normalizes applications, smoothing nested timestamp shapes', async () => {
    server.use(
      http.get(`${BASE}/v2/recruiting/applications`, () =>
        HttpResponse.json({
          _data: [
            {
              id: 'app1',
              application_date: '2026-06-01',
              candidate: { id: 'c1', first_name: 'Anna', last_name: 'Schmidt', email: 'a@x.de' },
              job: { id: 'j1', name: 'Engineer', department: { id: 'd1', name: 'R&D' } },
              current_stage: { id: 's1', kind: 'interview', name: 'Interview', type: 'interview' },
              channel: { id: 'ch1', name: 'LinkedIn' },
              is_anonymized: false,
              created_at: { 'date-time': '2026-06-01T10:00:00', timezone: 'Europe/Berlin' },
              updated_at: { 'date-time': '2026-06-02T10:00:00', timezone: 'Europe/Berlin' },
            },
          ],
        })
      )
    );

    const records = await new RecruitingService(makeClient()).getApplications();
    expect(records[0]).toEqual({
      id: 'app1',
      applicationDate: '2026-06-01',
      candidateId: 'c1',
      candidateName: 'Anna Schmidt',
      candidateEmail: 'a@x.de',
      jobId: 'j1',
      jobName: 'Engineer',
      department: 'R&D',
      stageName: 'Interview',
      stageType: 'interview',
      channel: 'LinkedIn',
      isAnonymized: false,
      createdAt: '2026-06-01T10:00:00',
      updatedAt: '2026-06-02T10:00:00',
    });
  });
});
