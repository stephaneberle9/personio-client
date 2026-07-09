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
