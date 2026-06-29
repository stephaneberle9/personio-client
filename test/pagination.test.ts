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

describe('HttpClient cursor pagination', () => {
  it('follows _meta.links.next across pages and concatenates _data', async () => {
    const seenAuth: string[] = [];
    server.use(
      http.get(`${BASE}/v2/things`, ({ request }) => {
        seenAuth.push(request.headers.get('authorization') ?? '');
        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor');
        if (!cursor) {
          return HttpResponse.json({
            _data: [{ id: '1' }, { id: '2' }],
            _meta: { links: { next: { href: `${BASE}/v2/things?cursor=p2` } } },
          });
        }
        if (cursor === 'p2') {
          return HttpResponse.json({
            _data: [{ id: '3' }],
            _meta: { links: { next: { href: `${BASE}/v2/things?cursor=p3` } } },
          });
        }
        return HttpResponse.json({ _data: [{ id: '4' }], _meta: { links: {} } });
      })
    );

    const client = makeHttp();
    const all = await client.getAll<{ id: string }>('/v2/things', { limit: 100 });

    expect(all.map((t) => t.id)).toEqual(['1', '2', '3', '4']);
    // Bearer token applied to the follow-up (absolute-URL) page requests too.
    expect(seenAuth.every((h) => h === 'Bearer tok')).toBe(true);
    expect(seenAuth).toHaveLength(3);
  });

  it('refuses to follow a pagination link to a foreign origin (SSRF guard)', async () => {
    server.use(
      http.get(`${BASE}/v2/things`, () =>
        HttpResponse.json({
          _data: [{ id: '1' }],
          _meta: { links: { next: { href: 'https://evil.example.com/v2/things?cursor=p2' } } },
        })
      ),
      // The foreign host must never receive a request (and never the token).
      http.get('https://evil.example.com/v2/things', () => HttpResponse.json({ _data: [] }))
    );

    const client = makeHttp();
    await expect(client.getAll('/v2/things')).rejects.toThrow(/foreign origin/i);
  });

  it('returns a single page unchanged when there is no next link', async () => {
    server.use(
      http.get(`${BASE}/v2/things`, () => HttpResponse.json({ _data: [{ id: 'only' }] }))
    );
    const client = makeHttp();
    const all = await client.getAll<{ id: string }>('/v2/things');
    expect(all).toEqual([{ id: 'only' }]);
  });
});
