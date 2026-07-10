/**
 * Client-side rate limiter that paces outbound requests to stay under
 * Personio's rate limits without the caller having to guess a number.
 *
 * Personio fronts the API with a Spring Cloud Gateway token bucket and reports
 * its state on every response (`x-ratelimit-replenish-rate` / `-burst-capacity`
 * / `-requested-tokens` / `-remaining`). Crucially the limits are **per
 * endpoint** (e.g. `/v2/persons` is 30 req/s, `/v2/absence-periods` is 10 req/s),
 * so this limiter keeps an independent token bucket per endpoint — persons can
 * run at its own rate concurrently with a slower endpoint rather than all
 * traffic sharing one gate at the slowest rate.
 *
 * Each bucket uses GCRA (a token bucket expressed as a single "theoretical
 * arrival time"): it spends the burst at full speed while tokens remain, then
 * paces at the refill rate — mirroring the server's own bucket, so a 429 is
 * avoided by construction rather than merely survived. When the headers are
 * absent (a different host, or an older gateway), the bucket falls back to
 * reactive AIMD (widen on 429, relax on success).
 */
export interface RateLimiterOptions {
  /** Steady-state minimum spacing when healthy (ms). Default 0 (full speed). */
  floorMs?: number;
  /** Hard ceiling for the AIMD fallback interval (ms). Default 2000. */
  ceilingMs?: number;
  /** Interval adopted on the first 429 in AIMD fallback (ms). Default 50. */
  baseMs?: number;
  /** Factor the AIMD interval is multiplied by per 429 window. Default 2. */
  backoffFactor?: number;
  /** Additive reduction applied per successful response in AIMD fallback (ms). Default 5. */
  recoverMs?: number;
  /** Injectable clock, for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable sleep, for tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Token-bucket state Personio reports on every response. Any field may be
 * absent on non-Personio hosts or older gateways.
 */
export interface RateLimitInfo {
  /** Tokens refilled per second — the sustained request rate. */
  replenishRate?: number;
  /** Bucket size — how large a burst is allowed. */
  burstCapacity?: number;
  /** Tokens left right now. */
  remaining?: number;
  /** Token cost of one request. */
  requestedTokens?: number;
}

const DEFAULT_CEILING_MS = 2000;
const DEFAULT_BASE_MS = 50;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_RECOVER_MS = 5;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function headerNumber(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Extract Personio's token-bucket headers (`x-ratelimit-*`) into {@link
 * RateLimitInfo}. Keys are matched case-insensitively.
 */
export function parseRateLimitHeaders(headers: Record<string, unknown> | undefined): RateLimitInfo {
  if (!headers) return {};
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    replenishRate: headerNumber(lower['x-ratelimit-replenish-rate']),
    burstCapacity: headerNumber(lower['x-ratelimit-burst-capacity']),
    remaining: headerNumber(lower['x-ratelimit-remaining']),
    requestedTokens: headerNumber(lower['x-ratelimit-requested-tokens']),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize a request path to the key of the endpoint's rate-limit bucket, so
 * every id maps to the same bucket: `/v2/absence-periods/<uuid>/breakdowns` →
 * `/v2/absence-periods/{id}/breakdowns`.
 */
export function bucketKeyForPath(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => (UUID_RE.test(seg) || /^\d+$/.test(seg) ? '{id}' : seg))
    .join('/');
}

interface BucketOptions {
  floorMs: number;
  ceilingMs: number;
  baseMs: number;
  backoffFactor: number;
  recoverMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** One endpoint's token bucket (GCRA when header-seeded, AIMD otherwise). */
class TokenBucket {
  // Header-seeded (GCRA) state.
  private emissionIntervalMs = 0; // 1000 / replenishRate; 0 = rate unknown
  private capacity = 0;
  private cost = 1;
  /** Theoretical arrival time: the GCRA cursor, in the `now` clock. */
  private tat = 0;

  // AIMD fallback state (used only until a rate is learned).
  private currentMs: number;
  private nextSlotAt = 0;
  private lastRaiseAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly o: BucketOptions) {
    this.currentMs = o.floorMs;
  }

  /** Current steady-state spacing (ms): the refill interval once known, else the AIMD value. */
  get intervalMs(): number {
    return this.emissionIntervalMs > 0 ? Math.max(this.emissionIntervalMs, this.o.floorMs) : this.currentMs;
  }

  /** Claim a slot and wait until this request may go out. */
  async acquire(): Promise<void> {
    if (this.emissionIntervalMs > 0) {
      // GCRA: allow a burst up to `capacity`, then pace at the refill rate.
      const t = Math.max(this.emissionIntervalMs, this.o.floorMs);
      const tolerance = Math.max(0, this.capacity - 1) * t; // burst window
      const increment = this.cost * t;
      const now = this.o.now();
      const tat = Math.max(this.tat, now);
      const wait = tat - tolerance - now;
      this.tat = tat + increment; // reserve, before any await, so concurrent callers queue
      // Ignore sub-millisecond waits: they are float noise from accumulating the
      // fractional emission interval, and a <1 ms sleep is meaningless anyway.
      if (wait >= 1) await this.o.sleep(wait);
      return;
    }

    // Fallback: fixed floor / AIMD slot pacing.
    const interval = this.currentMs;
    if (interval <= 0) return;
    const now = this.o.now();
    const startAt = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = startAt + interval;
    const wait = startAt - now;
    if (wait > 0) await this.o.sleep(wait);
  }

  /** Update the bucket from a response. */
  observe(status: number, info: RateLimitInfo): void {
    const rate = info.replenishRate;
    if (rate && rate > 0) {
      this.cost = info.requestedTokens && info.requestedTokens > 0 ? info.requestedTokens : 1;
      this.emissionIntervalMs = 1000 / rate;
      if (info.burstCapacity && info.burstCapacity > 0) this.capacity = info.burstCapacity;

      // Reconcile the GCRA cursor with the reported fill level, but only ever to
      // slow down (max): under concurrency, responses arrive out of order, so a
      // stale-high `remaining` must never speed us up. A low reading pushes the
      // cursor forward (more conservative) and self-heals as time advances.
      if (info.remaining !== undefined && this.capacity > 0) {
        const t = Math.max(this.emissionIntervalMs, this.o.floorMs);
        const wantTat = this.o.now() + (this.capacity - info.remaining) * t;
        this.tat = Math.max(this.tat, wantTat);
      }
      return;
    }

    // No token-bucket headers: reactive fallback.
    if (status === 429) this.onThrottled();
    else this.onSuccess();
  }

  private onThrottled(): void {
    const now = this.o.now();
    if (this.currentMs > 0 && now - this.lastRaiseAt < this.currentMs) return;
    this.lastRaiseAt = now;
    const raised = this.currentMs <= 0 ? this.o.baseMs : this.currentMs * this.o.backoffFactor;
    this.currentMs = Math.min(this.o.ceilingMs, Math.max(this.o.baseMs, raised));
  }

  private onSuccess(): void {
    if (this.currentMs > this.o.floorMs) {
      this.currentMs = Math.max(this.o.floorMs, this.currentMs - this.o.recoverMs);
    }
  }
}

/**
 * Manages one {@link TokenBucket} per endpoint, keyed by {@link bucketKeyForPath}.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly defaults: BucketOptions;

  constructor(options: RateLimiterOptions = {}) {
    const floorMs = Math.max(0, options.floorMs ?? 0);
    const ceilingMs = Math.max(floorMs, options.ceilingMs ?? DEFAULT_CEILING_MS);
    this.defaults = {
      floorMs,
      ceilingMs,
      baseMs: Math.min(ceilingMs, Math.max(1, options.baseMs ?? DEFAULT_BASE_MS)),
      backoffFactor: options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
      recoverMs: Math.max(0, options.recoverMs ?? DEFAULT_RECOVER_MS),
      now: options.now ?? Date.now,
      sleep: options.sleep ?? realSleep,
    };
  }

  private bucketFor(key: string): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.defaults);
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /** Pace a request to the bucket for `key` (from {@link bucketKeyForPath}). */
  acquire(key: string): Promise<void> {
    return this.bucketFor(key).acquire();
  }

  /** Feed a response outcome back to the bucket for `key`. */
  observe(key: string, status: number, info: RateLimitInfo = {}): void {
    this.bucketFor(key).observe(status, info);
  }

  /** Current steady-state spacing (ms) for `key`, for tests/telemetry. */
  intervalMsFor(key: string): number {
    return this.buckets.get(key)?.intervalMs ?? this.defaults.floorMs;
  }
}
