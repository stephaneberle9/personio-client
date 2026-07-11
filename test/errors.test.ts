import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { OAuthClient } from '../src/auth/oauth-client.js';
import { HttpClient } from '../src/http/client.js';

const BASE = 'https://api.personio.test';

const server = setupServer(
  http.post(`${BASE}/v2/auth/token`, () =>
    HttpResponse.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeHttp() {
  const auth = new OAuthClient({
    clientId: 'id',
    clientSecret: 'secret',
    baseUrl: BASE,
    timeoutMs: 5_000,
  });
  return new HttpClient({ baseUrl: BASE, timeoutMs: 5_000, auth, maxRetries: 0, retryBaseMs: 1 });
}

/** Drive a rejecting request and return the resulting error message. */
async function messageFrom(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error('expected the request to reject, but it resolved');
  } catch (error) {
    return (error as Error).message;
  }
}

describe('scope-aware hints beyond 403', () => {
  // Confirmed live (scripts/probe-scopes.ts, low-privilege credential): a
  // missing persons read right surfaces as 401 "Unauthorized Request", not 403.
  it('hints a possible missing right on a 401 for a non-token path', async () => {
    server.use(
      http.get(`${BASE}/v2/persons`, () =>
        HttpResponse.json({ error: { message: 'Unauthorized Request' } }, { status: 401 })
      )
    );

    const message = await messageFrom(makeHttp().get('/v2/persons'));
    expect(message).toContain('Personio API error (401) on /v2/persons');
    expect(message).toContain('invalid or expired token');
    expect(message).toContain('missing the access right');
    expect(message).toContain('expected scope: personio:persons:read');
  });

  // The token request's own 401 is genuinely a credential problem — it must not
  // gain the ambiguous "maybe a missing right" hint.
  it('leaves the /auth/token 401 unchanged (no missing-right hint)', async () => {
    server.use(
      http.post(`${BASE}/v2/auth/token`, () =>
        HttpResponse.json({ error: { message: 'invalid_client' } }, { status: 401 })
      )
    );

    // Any API call triggers the token fetch, which fails first.
    const message = await messageFrom(makeHttp().get('/v2/persons'));
    expect(message).toContain('Personio API error (401) on /v2/auth/token');
    expect(message).not.toContain('access right');
    expect(message).not.toContain('expected scope');
  });
});

describe('/v2/reports 400 flavors', () => {
  // Flavor 1: the credential lacks the reports read right → 400 "Unauthorized token".
  it('hints a missing reports right on 400 "Unauthorized token"', async () => {
    server.use(
      http.get(`${BASE}/v2/reports`, () =>
        HttpResponse.json({ error: { message: 'Unauthorized token' } }, { status: 400 })
      )
    );

    const message = await messageFrom(makeHttp().get('/v2/reports'));
    expect(message).toContain('Personio API error (400) on /v2/reports');
    expect(message).toContain('lacks the reports read access right');
    expect(message).toContain('expected scope: personio:reports:read');
  });

  // Flavor 2: a chart/grouped report cannot be read via the API.
  it('hints chart grouping on 400 "Unsupported nested type"', async () => {
    server.use(
      http.get(`${BASE}/v2/reports/grouped`, () =>
        HttpResponse.json({ error: { message: 'Unsupported nested type: null' } }, { status: 400 })
      )
    );

    const message = await messageFrom(makeHttp().get('/v2/reports/grouped'));
    expect(message).toContain('built with chart grouping');
    expect(message).toContain('flat table reports');
    expect(message).toContain('chart_type is not a reliable indicator');
  });

  // Flavor 3: a wrong id (or a report without API access activated) → JSON:API
  // envelope with a "not found" detail.
  it('hints wrong id or inactive API access on 400 with a JSON:API not-found envelope', async () => {
    server.use(
      http.get(`${BASE}/v2/reports/00000000-0000-0000-0000-000000000000`, () =>
        HttpResponse.json(
          {
            errors: [
              {
                status: '400',
                title: 'Bad Request',
                id: '8e75b254-a3e3-41fe-828a-909428f92427',
                detail: 'Report with 00000000-0000-0000-0000-000000000000 not found.',
              },
            ],
          },
          { status: 400 }
        )
      )
    );

    const message = await messageFrom(
      makeHttp().get('/v2/reports/00000000-0000-0000-0000-000000000000')
    );
    expect(message).toContain('not found.'); // the raw API detail is preserved
    expect(message).toContain('wrong report id');
    expect(message).toContain('does not have API access activated');
    expect(message).toContain('per-report toggle');
    expect(message).toContain('empty 200 list');
  });
});

describe('unhinted statuses stay unchanged', () => {
  // A 400 on any non-reports endpoint keeps the plain message.
  it('does not hint a generic 400 elsewhere', async () => {
    server.use(
      http.get(`${BASE}/v2/persons`, () =>
        HttpResponse.json(
          { error: { message: 'Provided value for limit is not valid' } },
          { status: 400 }
        )
      )
    );

    const message = await messageFrom(makeHttp().get('/v2/persons'));
    expect(message).toContain('Personio API error (400) on /v2/persons');
    expect(message).toContain('Provided value for limit is not valid');
    expect(message).not.toContain('access right');
    expect(message).not.toContain('report');
  });

  // The pre-existing 403 hint is untouched.
  it('keeps the 403 hint naming the expected scope', async () => {
    server.use(
      http.get(`${BASE}/v2/attendance-periods`, () =>
        HttpResponse.json({ error: { message: 'Insufficient access scope' } }, { status: 403 })
      )
    );

    const message = await messageFrom(makeHttp().get('/v2/attendance-periods'));
    expect(message).toContain('Personio API error (403) on /v2/attendance-periods');
    expect(message).toContain('Access denied');
    expect(message).toContain('expected scope: personio:attendances:read');
  });
});

describe('extractApiMessage', () => {
  // Confirmed live against /v2/reports/{id} with an unknown id: Personio
  // returns this JSON:API-style envelope instead of the { error/message/detail }
  // shapes the other endpoints use.
  it('extracts detail from a JSON:API-style errors[] envelope', async () => {
    server.use(
      http.get(`${BASE}/v2/reports/00000000-0000-0000-0000-000000000000`, () =>
        HttpResponse.json(
          {
            errors: [
              {
                status: '400',
                title: 'Bad Request',
                id: '8e75b254-a3e3-41fe-828a-909428f92427',
                detail: 'Report with 00000000-0000-0000-0000-000000000000 not found.',
              },
            ],
          },
          { status: 400 }
        )
      )
    );

    const client = makeHttp();
    await expect(
      client.get('/v2/reports/00000000-0000-0000-0000-000000000000')
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Report with 00000000-0000-0000-0000-000000000000 not found.'),
    });
  });
});
