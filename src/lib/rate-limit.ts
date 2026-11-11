/**
 * Per-user, in-memory rate limiter.
 *
 * Why in-memory:
 *  - Simple. No Redis dependency. Fine for a single-process Node server
 *    or a single Vercel serverless instance.
 *  - For multi-instance prod (Vercel with multiple lambdas), each
 *    instance has its own counter, so the effective limit becomes
 *    N × limit per instance. That's acceptable for ForexMind's traffic
 *    profile (a few hundred users, low-frequency AI calls). If we ever
 *    need stricter multi-instance limits, swap the Map for an Upstash
 *    Redis counter - the public API (rateLimit.check) stays the same.
 *
 * Why token bucket:
 *  - Allows short bursts (a user pasting 3 chat messages in 5s) without
 *    hard-failing, while still capping the long-term rate.
 *  - Refills continuously, so a user who hasn't typed in an hour gets
 *    the full bucket back instantly.
 *
 * Why per-user (not per-IP):
 *  - Authenticated routes already know the user. Per-user is fairer
 *    than per-IP (which lags NAT'd users together) and harder to
 *    evade (one user can't rotate IPs to bypass).
 *  - For unauthenticated routes (public /api/news), we fall back to
 *    per-IP via x-forwarded-for. That's a softer limit, mainly to
 *    keep crawlers off the cache.
 *
 * Memory hygiene:
 *  - The Map grows by user-id. We sweep it periodically (every 5 min)
 *    and drop entries whose bucket is full AND hasn't been touched
 *    in 10+ minutes - i.e. inactive users. Active users keep their
 *    bucket. This bounds the Map to roughly the active-user count.
 */

/** A token bucket. `tokens` is fractional; `lastRefill` is ms epoch. */
type Bucket = {
  tokens: number;
  lastRefill: number;
  /** Last request timestamp, used by the sweeper. */
  lastSeen: number;
};

/** Configuration for one rate-limit bucket kind. */
export type RateLimitConfig = {
  /** Bucket capacity (max burst size). */
  capacity: number;
  /** Refill rate: tokens added per second. */
  refillPerSec: number;
  /** Identifier prefix used in the per-key Map. */
  prefix: string;
};

/**
 * Predefined rate-limit profiles.
 *
 *  - ai: 20 messages per minute burst, refills at 1/sec.
 *    Covers /api/chat and /api/news/brief (these consume Groq tokens).
 *  - checker: 10 checks per minute burst, refills at 0.5/sec.
 *    /api/checker - heavier per-call (1500 tokens, JSON output).
 *  - write: 60 mutations per minute, refills at 2/sec.
 *    /api/trades POST/PATCH/DELETE - cheap DB ops, allow generous
 *    headroom for legit UI clicks (table scroll, filter, etc.).
 *  - read: 120 reads per minute, refills at 4/sec.
 *    /api/trades GET, /api/news GET.
 *
 * Numbers chosen to be invisible to a real user typing in the UI,
 * but visibly throttling a script that POSTs in a tight loop.
 */
export const RATE_LIMITS = {
  ai: { capacity: 20, refillPerSec: 1, prefix: "ai" },
  checker: { capacity: 10, refillPerSec: 0.5, prefix: "checker" },
  write: { capacity: 60, refillPerSec: 2, prefix: "write" },
  read: { capacity: 120, refillPerSec: 4, prefix: "read" },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitKind = keyof typeof RATE_LIMITS;

/**
 * Result of a rate-limit check.
 *
 * `success: false` means the bucket is empty; the route handler
 * should respond with HTTP 429 and the suggested Retry-After.
 */
export type RateLimitResult = {
  success: boolean;
  /** Tokens remaining after this check (0 if blocked). */
  remaining: number;
  /** Seconds until the next token refills. For the Retry-After header. */
  retryAfterSec: number;
  /** Bucket capacity (for the X-RateLimit-Limit header). */
  limit: number;
};

/** @internal module-level store. Exposed for tests via __bucketsForTests. */
const buckets = new Map<string, Bucket>();

/** Sweeper: drop inactive buckets every 5 minutes. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const INACTIVE_TTL_MS = 10 * 60 * 1000;
let lastSweepAt = 0;

function maybeSweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, b] of buckets) {
    if (now - b.lastSeen > INACTIVE_TTL_MS) {
      buckets.delete(key);
    }
  }
}

function refill(bucket: Bucket, now: number, cfg: RateLimitConfig): void {
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  if (elapsedSec <= 0) return;
  const refilled = elapsedSec * cfg.refillPerSec;
  bucket.tokens = Math.min(cfg.capacity, bucket.tokens + refilled);
  bucket.lastRefill = now;
}

/**
 * Check whether the caller identified by `key` is allowed to make one
 * more request of the given `kind`. Decrements the bucket if so.
 *
 * Pure-ish: mutates the in-memory Map but deterministic given the
 * same `now`. Safe to call from any route handler.
 */
export function rateLimitCheck(
  key: string,
  kind: RateLimitKind,
  now: number = Date.now(),
): RateLimitResult {
  const cfg = RATE_LIMITS[kind];
  const mapKey = `${cfg.prefix}:${key}`;

  maybeSweep(now);

  let bucket = buckets.get(mapKey);
  if (!bucket) {
    // New bucket: starts full.
    bucket = {
      tokens: cfg.capacity,
      lastRefill: now,
      lastSeen: now,
    };
    buckets.set(mapKey, bucket);
  }

  bucket.lastSeen = now;
  refill(bucket, now, cfg);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      success: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterSec: 0,
      limit: cfg.capacity,
    };
  }

  // Bucket empty: compute when the next token will be available.
  // At least 1 second so the Retry-After header is meaningful.
  const secsUntilNext = Math.max(1, Math.ceil(1 / cfg.refillPerSec));
  return {
    success: false,
    remaining: 0,
    retryAfterSec: secsUntilNext,
    limit: cfg.capacity,
  };
}

/**
 * Convenience: format a rate-limit result as standard headers.
 *
 * Returns `{ headers, json }` so a route can either:
 *   - early-return a 429 with these headers + the json body, OR
 *   - attach the headers to a successful 200/201 response.
 */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    ...(r.success ? {} : { "Retry-After": String(r.retryAfterSec) }),
  };
}

// ---------------------------------------------------------------------------
// Test helpers (only used by rate-limit.test.ts)
// ---------------------------------------------------------------------------

/**
 * @internal Reset the bucket store between tests. Not for app code.
 */
export function __resetBucketsForTests(): void {
  buckets.clear();
  lastSweepAt = 0;
}

/**
 * @internal Snapshot the bucket store for assertions. Not for app code.
 */
export function __bucketsForTests(): ReadonlyMap<string, Bucket> {
  return buckets;
}
