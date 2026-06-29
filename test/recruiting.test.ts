import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PersonioClient } from '../src/client.js';

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

describe('RecruitingEndpoint', () => {
  it('sends the Beta header and auto-paginates over _meta.links.next', async () => {
    const betaHeaders: Array<string | null> = [];
    server.use(
      http.get(`${BASE}/v2/recruiting/applications`, ({ request }) => {
        betaHeaders.push(request.headers.get('beta'));
        const cursor = new URL(request.url).searchParams.get('cursor');
        if (!cursor) {
          return HttpResponse.json({
            _data: [{ id: 'app1' }],
            _meta: { links: { next: { href: `${BASE}/v2/recruiting/applications?cursor=p2` } } },
          });
        }
        return HttpResponse.json({ _data: [{ id: 'app2' }] });
      })
    );

    const apps = await makeClient().recruiting.applications();
    expect(apps.map((a) => a.id)).toEqual(['app1', 'app2']);
    expect(betaHeaders).toEqual(['true', 'true']);
  });

  it('unwraps the _data envelope for a single resource', async () => {
    server.use(
      http.get(`${BASE}/v2/recruiting/jobs/j1`, () => HttpResponse.json({ _data: { id: 'j1', name: 'Engineer' } }))
    );
    const job = await makeClient().recruiting.job('j1');
    expect(job).toEqual({ id: 'j1', name: 'Engineer' });
  });

  it('formats an application into a flat shape', () => {
    const formatted = makeClient().recruiting.formatApplication({
      id: 'app1',
      application_date: '2026-06-01',
      candidate: { id: 'c1', first_name: 'Anna', last_name: 'Schmidt', email: 'a@x.de' },
      job: { id: 'j1', name: 'Engineer', department: { name: 'R&D' } },
      current_stage: { name: 'Interview', type: 'interview' },
      is_anonymized: false,
    });
    expect(formatted).toMatchObject({
      id: 'app1',
      candidate: { name: 'Anna Schmidt', email: 'a@x.de' },
      job: { name: 'Engineer', department: 'R&D' },
      current_stage: { name: 'Interview' },
    });
  });
});
