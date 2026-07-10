import { describe, expect, it } from 'vitest';
import { RateLimiter, parseRateLimitHeaders, bucketKeyForPath } from '../src/http/rate-limiter.js';

/** A controllable virtual clock so timing assertions stay deterministic. */
function makeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const EP = '/v2/things';

describe('bucketKeyForPath', () => {
  it('normalizes ids so every id maps to one bucket', () => {
    expect(bucketKeyForPath('/v2/absence-periods/f8228cda-5615-4e81-8cba-21fa5e996291/breakdowns')).toBe(
      '/v2/absence-periods/{id}/breakdowns'
    );
    expect(bucketKeyForPath('/v2/attendance-periods/12345')).toBe('/v2/attendance-periods/{id}');
    expect(bucketKeyForPath('/v2/persons')).toBe('/v2/persons');
  });
});

describe('parseRateLimitHeaders', () => {
  it('parses the token-bucket headers case-insensitively, ignoring absent ones', () => {
    expect(
      parseRateLimitHeaders({
        'x-ratelimit-replenish-rate': '30',
        'x-ratelimit-burst-capacity': '100',
        'x-ratelimit-requested-tokens': '1',
        'x-ratelimit-remaining': '42',
      })
    ).toEqual({ replenishRate: 30, burstCapacity: 100, requestedTokens: 1, remaining: 42 });
    expect(parseRateLimitHeaders({ 'X-RateLimit-Replenish-Rate': '30' })).toEqual({
      replenishRate: 30,
      burstCapacity: undefined,
      remaining: undefined,
      requestedTokens: undefined,
    });
    expect(parseRateLimitHeaders(undefined)).toEqual({});
  });
});

describe('RateLimiter — header-seeded token bucket (GCRA)', () => {
  it('spends the burst at full speed, then paces at the refill rate', async () => {
    const sleeps: number[] = [];
    const rl = new RateLimiter({ now: () => 0, sleep: async (ms) => void sleeps.push(ms) });
    rl.observe(EP, 200, { replenishRate: 30, burstCapacity: 100, remaining: 100 });

    for (let i = 0; i < 100; i++) await rl.acquire(EP); // full bucket → 100 free
    expect(sleeps).toEqual([]);

    await rl.acquire(EP); // 101st must wait one refill interval
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeCloseTo(1000 / 30, 5);
  });

  it('paces at the refill rate once the burst is spent (advancing clock)', async () => {
    const clock = makeClock();
    const sleeps: number[] = [];
    const rl = new RateLimiter({
      now: clock.now,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
    });
    rl.observe(EP, 200, { replenishRate: 10, burstCapacity: 10, remaining: 10 });

    for (let i = 0; i < 10; i++) await rl.acquire(EP); // burst of 10
    expect(sleeps).toEqual([]);
    await rl.acquire(EP);
    await rl.acquire(EP);
    expect(sleeps).toEqual([100, 100]); // then 10/s → 100 ms apart
  });

  it('reports the refill interval, capped below by a configured floor', () => {
    const fast = new RateLimiter({ now: () => 0 });
    fast.observe(EP, 200, { replenishRate: 30, burstCapacity: 100, remaining: 100 });
    expect(fast.intervalMsFor(EP)).toBeCloseTo(1000 / 30, 5);

    const floored = new RateLimiter({ now: () => 0, floorMs: 50 });
    floored.observe(EP, 200, { replenishRate: 30, burstCapacity: 100, remaining: 100 });
    expect(floored.intervalMsFor(EP)).toBe(50); // never faster than the floor
  });

  it('reconciles with `remaining` only to slow down — a stale-high reading cannot un-pace', async () => {
    const sleeps: number[] = [];
    const rl = new RateLimiter({ now: () => 0, sleep: async (ms) => void sleeps.push(ms) });
    rl.observe(EP, 200, { replenishRate: 30, burstCapacity: 100, remaining: 100 });

    // Bucket reported empty → the next request must pace, not burst.
    rl.observe(EP, 429, { replenishRate: 30, burstCapacity: 100, remaining: 0 });
    await rl.acquire(EP);
    expect(sleeps[0]).toBeCloseTo(1000 / 30, 5);

    // A later stale-high reading must NOT speed us back up.
    rl.observe(EP, 200, { replenishRate: 30, burstCapacity: 100, remaining: 100 });
    sleeps.length = 0;
    await rl.acquire(EP);
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  it('keeps an independent bucket per endpoint', () => {
    const rl = new RateLimiter({ now: () => 0 });
    rl.observe('/v2/persons', 200, { replenishRate: 30, burstCapacity: 100 });
    rl.observe('/v2/absence-periods', 200, { replenishRate: 10, burstCapacity: 10 });
    expect(rl.intervalMsFor('/v2/persons')).toBeCloseTo(1000 / 30, 5);
    expect(rl.intervalMsFor('/v2/absence-periods')).toBeCloseTo(100, 5);
  });
});

describe('RateLimiter — AIMD fallback (no token-bucket headers)', () => {
  it('runs at full speed at the default floor (no waits)', async () => {
    const sleeps: number[] = [];
    const rl = new RateLimiter({ now: () => 0, sleep: async (ms) => void sleeps.push(ms) });
    await rl.acquire(EP);
    await rl.acquire(EP);
    expect(rl.intervalMsFor(EP)).toBe(0);
    expect(sleeps).toEqual([]);
  });

  it('widens multiplicatively on a headerless 429, up to the ceiling', () => {
    const clock = makeClock();
    const rl = new RateLimiter({ now: clock.now, baseMs: 50, ceilingMs: 400 });
    rl.observe(EP, 429, {});
    expect(rl.intervalMsFor(EP)).toBe(50);
    clock.advance(50);
    rl.observe(EP, 429, {});
    expect(rl.intervalMsFor(EP)).toBe(100);
    clock.advance(100);
    rl.observe(EP, 429, {});
    expect(rl.intervalMsFor(EP)).toBe(200);
    clock.advance(200);
    rl.observe(EP, 429, {});
    expect(rl.intervalMsFor(EP)).toBe(400);
    clock.advance(400);
    rl.observe(EP, 429, {});
    expect(rl.intervalMsFor(EP)).toBe(400); // capped
  });

  it('debounces a burst of concurrent headerless 429s to a single raise', () => {
    const clock = makeClock();
    const rl = new RateLimiter({ now: clock.now, baseMs: 50 });
    rl.observe(EP, 429, {});
    rl.observe(EP, 429, {});
    rl.observe(EP, 429, {});
    expect(rl.intervalMsFor(EP)).toBe(50);
    clock.advance(50);
    rl.observe(EP, 429, {});
    expect(rl.intervalMsFor(EP)).toBe(100);
  });

  it('relaxes additively toward the floor on success', () => {
    const rl = new RateLimiter({ now: () => 0, baseMs: 50, recoverMs: 20, floorMs: 0 });
    rl.observe(EP, 429, {});
    expect(rl.intervalMsFor(EP)).toBe(50);
    rl.observe(EP, 200, {});
    expect(rl.intervalMsFor(EP)).toBe(30);
    rl.observe(EP, 200, {});
    expect(rl.intervalMsFor(EP)).toBe(10);
    rl.observe(EP, 200, {});
    expect(rl.intervalMsFor(EP)).toBe(0);
    rl.observe(EP, 200, {});
    expect(rl.intervalMsFor(EP)).toBe(0);
  });

  it('never relaxes below a positive floor', () => {
    const rl = new RateLimiter({ now: () => 0, floorMs: 100, recoverMs: 40 });
    rl.observe(EP, 429, {});
    expect(rl.intervalMsFor(EP)).toBe(200);
    rl.observe(EP, 200, {});
    expect(rl.intervalMsFor(EP)).toBe(160);
    rl.observe(EP, 200, {});
    expect(rl.intervalMsFor(EP)).toBe(120);
    rl.observe(EP, 200, {});
    expect(rl.intervalMsFor(EP)).toBe(100);
  });

  it('spaces acquired slots by the floor interval when no rate is known', async () => {
    const clock = makeClock();
    const sleeps: number[] = [];
    const rl = new RateLimiter({
      now: clock.now,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
      floorMs: 100,
    });
    await rl.acquire(EP);
    await rl.acquire(EP);
    await rl.acquire(EP);
    expect(sleeps).toEqual([100, 100]);
  });
});
