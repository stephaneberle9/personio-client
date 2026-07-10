import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { OAuthClient } from '../src/auth/oauth-client.js';
import { HttpClient } from '../src/http/client.js';

const BASE = 'https://api.personio.test';

const server = setupServer(
  http.post(`${BASE}/v2/auth/token`, () =>
    HttpResponse.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
  ),
  http.get(`${BASE}/v2/things`, () => HttpResponse.json({ _data: [] }))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeAuth() {
  return new OAuthClient({ clientId: 'id', clientSecret: 'secret', baseUrl: BASE, timeoutMs: 5_000 });
}

describe('HttpClient request throttle', () => {
  it('paces concurrent requests by minRequestIntervalMs (the N+1 case)', async () => {
    const sleeps: number[] = [];
    const client = new HttpClient({
      baseUrl: BASE,
      timeoutMs: 5_000,
      auth: makeAuth(),
      maxRetries: 0,
      retryBaseMs: 1,
      minRequestIntervalMs: 100,
      now: () => 0, // frozen clock — isolates slot assignment from wall time
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await Promise.all([1, 2, 3, 4].map(() => client.get('/v2/things')));

    // Four requests claim slots 0/100/200/300; only the slot-0 request skips
    // the wait. Sort because concurrent claim order isn't guaranteed, but the
    // set of assigned slots is.
    expect(sleeps.sort((a, b) => a - b)).toEqual([100, 200, 300]);
  });

  it('adapts: a 429 widens the throttle interval off the floor, then a success relaxes it', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v2/things`, () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ _data: [] });
      })
    );

    const client = new HttpClient({
      baseUrl: BASE,
      timeoutMs: 5_000,
      auth: makeAuth(),
      maxRetries: 2,
      retryBaseMs: 1,
      now: () => 0,
      sleep: async () => {},
      // no floor: full speed until the API pushes back
    });

    expect(client.throttleIntervalMs('/v2/things')).toBe(0);
    await client.get('/v2/things');

    // The 429 raised the steady interval to the base; the trailing success
    // relaxes it by one step but not back to zero in a single response.
    expect(client.throttleIntervalMs('/v2/things')).toBeGreaterThan(0);
    expect(calls).toBe(2);
  });

  it('seeds the pace from Personio token-bucket headers (low remaining → refill rate)', async () => {
    server.use(
      http.get(`${BASE}/v2/things`, () =>
        HttpResponse.json(
          { _data: [] },
          {
            headers: {
              'x-ratelimit-replenish-rate': '30',
              'x-ratelimit-burst-capacity': '100',
              'x-ratelimit-requested-tokens': '1',
              'x-ratelimit-remaining': '5', // near empty → pace to refill rate
            },
          }
        )
      )
    );

    const client = new HttpClient({
      baseUrl: BASE,
      timeoutMs: 5_000,
      auth: makeAuth(),
      maxRetries: 0,
      retryBaseMs: 1,
      now: () => 0,
      sleep: async () => {},
    });

    expect(client.throttleIntervalMs('/v2/things')).toBe(0);
    await client.get('/v2/things');
    expect(client.throttleIntervalMs('/v2/things')).toBeCloseTo(1000 / 30, 5); // refill interval
  });

  it('does not throttle when minRequestIntervalMs is 0 (default)', async () => {
    const sleeps: number[] = [];
    const client = new HttpClient({
      baseUrl: BASE,
      timeoutMs: 5_000,
      auth: makeAuth(),
      maxRetries: 0,
      retryBaseMs: 1,
      minRequestIntervalMs: 0,
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await Promise.all([1, 2, 3].map(() => client.get('/v2/things')));

    expect(sleeps).toEqual([]);
  });
});
