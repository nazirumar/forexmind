/**
 * Tests for the in-memory rate-limit module.
 *
 * Covers:
 *  - Token bucket math (capacity, refill, fractional accumulation)
 *  - Per-user isolation (user A's calls don't affect user B)
 *  - Per-kind isolation (AI bucket doesn't deplete write bucket)
 *  - Expiry + sweep (idle buckets drop after TTL)
 *  - Headers (X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After)
 *  - Edge cases: first call, exact-boundary call, sub-second refill
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  rateLimitCheck,
  rateLimitHeaders,
  RATE_LIMITS,
  __resetBucketsForTests,
  __bucketsForTests,
} from "@/lib/rate-limit";

beforeEach(() => {
  __resetBucketsForTests();
});

describe("rateLimitCheck - token bucket basics", () => {
  it("starts full and allows up to capacity calls in a burst", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMITS.ai.capacity; i++) {
      const r = rateLimitCheck("user-A", "ai", now);
      expect(r.success).toBe(true);
    }
    // The (capacity+1)-th call must be blocked.
    const blocked = rateLimitCheck("user-A", "ai", now);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("returns the correct remaining count after each call", () => {
    const now = 5_000_000;
    const r1 = rateLimitCheck("u", "ai", now);
    expect(r1.remaining).toBe(RATE_LIMITS.ai.capacity - 1);
    const r2 = rateLimitCheck("u", "ai", now);
    expect(r2.remaining).toBe(RATE_LIMITS.ai.capacity - 2);
    expect(r2.limit).toBe(RATE_LIMITS.ai.capacity);
  });

  it("refills continuously based on elapsed time", () => {
    const t0 = 10_000_000;
    // Drain the bucket fully (capacity=20 for ai).
    for (let i = 0; i < RATE_LIMITS.ai.capacity; i++) {
      rateLimitCheck("u", "ai", t0);
    }
    const blocked = rateLimitCheck("u", "ai", t0);
    expect(blocked.success).toBe(false);

    // Wait exactly enough for 1 token to refill (refillPerSec=1 -> 1s).
    const t1 = t0 + 1000;
    const ok = rateLimitCheck("u", "ai", t1);
    expect(ok.success).toBe(true);

    // Immediately after, the bucket is empty again.
    const blocked2 = rateLimitCheck("u", "ai", t1);
    expect(blocked2.success).toBe(false);
  });

  it("refills fractional tokens, accumulated across calls", () => {
    const t0 = 20_000_000;
    // Drain
    for (let i = 0; i < RATE_LIMITS.ai.capacity; i++) {
      rateLimitCheck("u", "ai", t0);
    }
    // 0.5 sec passes -> 0.5 tokens (still blocked)
    expect(rateLimitCheck("u", "ai", t0 + 500).success).toBe(false);
    // another 0.5 sec -> 1.0 tokens total (now allowed)
    expect(rateLimitCheck("u", "ai", t0 + 1000).success).toBe(true);
  });

  it("caps at capacity (no over-refill)", () => {
    const t0 = 30_000_000;
    rateLimitCheck("u", "ai", t0); // 19 left
    // Wait a long time
    const t1 = t0 + 1_000_000; // 1000 seconds
    const r = rateLimitCheck("u", "ai", t1);
    expect(r.success).toBe(true);
    expect(r.remaining).toBe(RATE_LIMITS.ai.capacity - 1); // not capacity+anything
  });
});

describe("rateLimitCheck - per-user isolation", () => {
  it("user A's calls don't affect user B's bucket", () => {
    const now = 1_000_000;
    // Drain A
    for (let i = 0; i < RATE_LIMITS.ai.capacity; i++) {
      rateLimitCheck("user-A", "ai", now);
    }
    expect(rateLimitCheck("user-A", "ai", now).success).toBe(false);
    // B should still have the full bucket.
    // First call to B: success, capacity-1 remaining.
    const b1 = rateLimitCheck("user-B", "ai", now);
    expect(b1.success).toBe(true);
    expect(b1.remaining).toBe(RATE_LIMITS.ai.capacity - 1);
    // Second call to B: success, capacity-2 remaining.
    const b2 = rateLimitCheck("user-B", "ai", now);
    expect(b2.success).toBe(true);
    expect(b2.remaining).toBe(RATE_LIMITS.ai.capacity - 2);
  });
});

describe("rateLimitCheck - per-kind isolation", () => {
  it("AI bucket doesn't deplete write bucket", () => {
    const now = 1_000_000;
    // Drain AI
    for (let i = 0; i < RATE_LIMITS.ai.capacity; i++) {
      rateLimitCheck("u", "ai", now);
    }
    expect(rateLimitCheck("u", "ai", now).success).toBe(false);
    // Write bucket is separate.
    // First call: success, capacity-1 remaining.
    const w1 = rateLimitCheck("u", "write", now);
    expect(w1.success).toBe(true);
    expect(w1.remaining).toBe(RATE_LIMITS.write.capacity - 1);
    // Second call: capacity-2 remaining.
    const w2 = rateLimitCheck("u", "write", now);
    expect(w2.remaining).toBe(RATE_LIMITS.write.capacity - 2);
  });

  it("checker, ai, write, read have distinct capacities", () => {
    expect(RATE_LIMITS.ai.capacity).toBe(20);
    expect(RATE_LIMITS.checker.capacity).toBe(10);
    expect(RATE_LIMITS.write.capacity).toBe(60);
    expect(RATE_LIMITS.read.capacity).toBe(120);
  });
});

describe("rateLimitCheck - sweeper", () => {
  it("drops buckets inactive for > 10 min", () => {
    const t0 = 1_000_000;
    rateLimitCheck("u", "ai", t0);
    expect(__bucketsForTests().size).toBe(1);

    // Trigger sweep with old "now" - the bucket's lastSeen is t0,
    // sweeper should drop it after INACTIVE_TTL_MS (10 min).
    const tFuture = t0 + 11 * 60 * 1000; // 11 minutes later
    rateLimitCheck("other-user", "ai", tFuture); // triggers sweep

    // The old "u" bucket should be gone; only "other-user" remains.
    expect(__bucketsForTests().size).toBe(1);
    expect(__bucketsForTests().has("ai:u")).toBe(false);
    expect(__bucketsForTests().has("ai:other-user")).toBe(true);
  });

  it("does NOT drop buckets active within the TTL window", () => {
    const t0 = 1_000_000;
    rateLimitCheck("u", "ai", t0);
    // Touch it 5 minutes later
    rateLimitCheck("u", "ai", t0 + 5 * 60 * 1000);
    // Sweep at t0 + 11 min - lastSeen is t0+5min, so 6 min ago, < TTL
    rateLimitCheck("other", "ai", t0 + 11 * 60 * 1000);
    expect(__bucketsForTests().has("ai:u")).toBe(true);
  });
});

describe("rateLimitHeaders", () => {
  it("includes limit + remaining on success, no Retry-After", () => {
    const r = rateLimitCheck("u", "ai", 1_000_000);
    const h = rateLimitHeaders(r);
    expect(h["X-RateLimit-Limit"]).toBe(String(RATE_LIMITS.ai.capacity));
    expect(h["X-RateLimit-Remaining"]).toBe(String(RATE_LIMITS.ai.capacity - 1));
    expect(h["Retry-After"]).toBeUndefined();
  });

  it("includes Retry-After on block", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMITS.ai.capacity; i++) {
      rateLimitCheck("u", "ai", now);
    }
    const r = rateLimitCheck("u", "ai", now);
    const h = rateLimitHeaders(r);
    expect(h["Retry-After"]).toBeDefined();
    expect(Number(h["Retry-After"])).toBeGreaterThanOrEqual(1);
    expect(h["X-RateLimit-Remaining"]).toBe("0");
  });
});

describe("rateLimitCheck - edge cases", () => {
  it("returns retryAfterSec >= 1 when blocked (never 0)", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMITS.ai.capacity; i++) {
      rateLimitCheck("u", "ai", now);
    }
    const blocked = rateLimitCheck("u", "ai", now);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("handles rapid successive calls without leaking tokens", () => {
    const now = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < RATE_LIMITS.ai.capacity + 50; i++) {
      if (rateLimitCheck("u", "ai", now).success) allowed++;
    }
    // Exactly capacity calls should succeed (the rest are blocked),
    // regardless of how fast they came in.
    expect(allowed).toBe(RATE_LIMITS.ai.capacity);
  });

  it("different keys with same prefix are still isolated", () => {
    const now = 1_000_000;
    // First call to user1: capacity-1 left.
    rateLimitCheck("user1", "ai", now);
    // First call to user2: capacity-1 left (their own bucket).
    rateLimitCheck("user2", "ai", now);
    expect(rateLimitCheck("user1", "ai", now).remaining).toBe(RATE_LIMITS.ai.capacity - 2);
    expect(rateLimitCheck("user2", "ai", now).remaining).toBe(RATE_LIMITS.ai.capacity - 2);
  });
});
