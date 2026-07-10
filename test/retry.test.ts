import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { OAuthClient } from '../src/auth/oauth-client.js';
import { HttpClient } from '../src/http/client.js';
import { PersonioApiError } from '../src/errors.js';

const BASE = 'https://api.personio.test';

const server = setupServer(
  http.post(`${BASE}/v2/auth/token`, () =>
    HttpResponse.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Build a client whose backoff waits are recorded rather than real. `sleep`
 * advances a virtual clock that `now` reads, so the adaptive rate limiter sees
 * time pass during backoff (as it would in production, where a 500 ms+ backoff
 * dwarfs the throttle interval) and doesn't inject spurious retry spacing.
 */
function makeHttp(maxRetries: number, delays: number[]) {
  const auth = new OAuthClient({
    clientId: 'id',
    clientSecret: 'secret',
    baseUrl: BASE,
    timeoutMs: 5_000,
  });
  let clock = 0;
  return new HttpClient({
    baseUrl: BASE,
    timeoutMs: 5_000,
    auth,
    maxRetries,
    retryBaseMs: 500,
    now: () => clock,
    sleep: async (ms) => {
      delays.push(ms);
      clock += ms;
    },
  });
}

describe('HttpClient 429 retry', () => {
  it('retries on 429 and returns the eventual success (conversion must not hide the status)', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v2/things`, () => {
        calls += 1;
        if (calls <= 2) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({ _data: [{ id: 'ok' }] });
      })
    );

    const delays: number[] = [];
    const client = makeHttp(3, delays);
    const body = await client.get<{ _data: { id: string }[] }>('/v2/things');

    expect(calls).toBe(3);
    expect(body._data).toEqual([{ id: 'ok' }]);
    // Exponential backoff on attempts 0 and 1: 500 * 2^0, 500 * 2^1.
    expect(delays).toEqual([500, 1000]);
  });

  it('honors a numeric Retry-After header over the exponential backoff', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v2/things`, () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '2' } });
        return HttpResponse.json({ _data: [] });
      })
    );

    const delays: number[] = [];
    const client = makeHttp(3, delays);
    await client.get('/v2/things');

    expect(delays).toEqual([2000]);
  });

  it('retries a transient 500 on a GET and returns the eventual success', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v2/persons`, () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 500 });
        return HttpResponse.json({ _data: [{ id: 'p1' }] });
      })
    );

    const delays: number[] = [];
    const client = makeHttp(3, delays);
    const body = await client.get<{ _data: { id: string }[] }>('/v2/persons');

    expect(calls).toBe(2);
    expect(body._data).toEqual([{ id: 'p1' }]);
    expect(delays).toEqual([500]);
  });

  it('does NOT retry a 500 on a non-idempotent POST (no unsafe replay)', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/v2/things`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      })
    );

    const delays: number[] = [];
    const client = makeHttp(3, delays);
    const error = await client.post('/v2/things', { a: 1 }).catch((e) => e);

    expect(error).toBeInstanceOf(PersonioApiError);
    expect((error as PersonioApiError).status).toBe(500);
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('surfaces a PersonioApiError with status 429 once retries are exhausted', async () => {
    server.use(http.get(`${BASE}/v2/things`, () => new HttpResponse(null, { status: 429 })));

    const delays: number[] = [];
    const client = makeHttp(2, delays);
    const error = await client.get('/v2/things').catch((e) => e);

    expect(error).toBeInstanceOf(PersonioApiError);
    expect((error as PersonioApiError).status).toBe(429);
    // maxRetries=2 → two backoff waits before the final failure.
    expect(delays).toHaveLength(2);
  });
});
