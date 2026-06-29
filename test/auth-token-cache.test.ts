import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { OAuthClient } from '../src/auth/oauth-client.js';

const BASE = 'https://api.personio.test';

let tokenRequests = 0;
const server = setupServer(
  http.post(`${BASE}/v2/auth/token`, async () => {
    tokenRequests += 1;
    return HttpResponse.json({
      access_token: `token-${tokenRequests}`,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  tokenRequests = 0;
});
afterAll(() => server.close());

function makeClient(now: () => number) {
  return new OAuthClient({
    clientId: 'papi-test',
    clientSecret: 'secret',
    baseUrl: BASE,
    timeoutMs: 5_000,
    now,
  });
}

describe('OAuthClient token cache', () => {
  it('requests a token once and reuses it within its lifetime', async () => {
    let clock = 1_000_000;
    const client = makeClient(() => clock);

    expect(await client.getAccessToken()).toBe('token-1');
    expect(await client.getAccessToken()).toBe('token-1');
    expect(tokenRequests).toBe(1);

    // Advance 30 min — still well inside the 1h lifetime minus 60s buffer.
    clock += 30 * 60 * 1000;
    expect(await client.getAccessToken()).toBe('token-1');
    expect(tokenRequests).toBe(1);
  });

  it('refreshes the token once it enters the 60s pre-expiry buffer', async () => {
    let clock = 0;
    const client = makeClient(() => clock);

    expect(await client.getAccessToken()).toBe('token-1');

    // 3600s lifetime, 60s buffer → refresh at 3540s. Just before: still cached.
    clock = 3_539_000;
    expect(await client.getAccessToken()).toBe('token-1');
    expect(tokenRequests).toBe(1);

    // Past the buffer threshold → a single refresh.
    clock = 3_541_000;
    expect(await client.getAccessToken()).toBe('token-2');
    expect(tokenRequests).toBe(2);
  });

  it('coalesces concurrent refreshes into a single token request', async () => {
    const client = makeClient(() => 0);
    const [a, b, c] = await Promise.all([
      client.getAccessToken(),
      client.getAccessToken(),
      client.getAccessToken(),
    ]);
    expect([a, b, c]).toEqual(['token-1', 'token-1', 'token-1']);
    expect(tokenRequests).toBe(1);
  });
});
