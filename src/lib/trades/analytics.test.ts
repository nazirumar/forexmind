/**
 * Tests for the pure analytics functions in src/lib/trades/analytics.ts.
 *
 * These run against the in-memory TradeRow shape, no DB / Supabase.
 * Companion to schema.test.ts which covers computeStats + equityCurve.
 */
import { describe, it, expect } from "vitest";
import {
  perPairStats,
  perSessionStats,
  drawdownSeries,
  maxDrawdown,
  pnlDistribution,
  perWeekdayStats,
  analyticsSummary,
  type PairStat,
} from "@/lib/trades/analytics";
import type { TradeRow } from "@/lib/trades/schema";

function makeRow(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: crypto.randomUUID(),
    user_id: crypto.randomUUID(),
    pair: "EURUSD",
    direction: "buy",
    entry_price: 1.085,
    exit_price: 1.09,
    stop_loss: 1.08,
    take_profit: 1.1,
    lot_size: 0.5,
    opened_at: "2026-01-01T08:00:00Z",
    closed_at: "2026-01-01T12:00:00Z",
    pnl: 0,
    strategy: "trend",
    session: "london",
    emotion: null,
    followed_plan: true,
    notes: null,
    created_at: "2026-01-01T08:00:00Z",
    tags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// perPairStats
// ---------------------------------------------------------------------------

describe("perPairStats", () => {
  it("returns empty for empty input", () => {
    expect(perPairStats([])).toEqual([]);
  });

  it("excludes trades with null pnl (open trades)", () => {
    const trades = [
      makeRow({ pnl: 100, pair: "EURUSD" }),
      makeRow({ pnl: null, pair: "EURUSD" }),
    ];
    const r = perPairStats(trades);
    expect(r).toHaveLength(1);
    expect(r[0]!.total).toBe(1);
  });

  it("groups by pair and computes win rate + net + avg", () => {
    const trades = [
      makeRow({ pnl: 100, pair: "EURUSD" }),
      makeRow({ pnl: -50, pair: "EURUSD" }),
      makeRow({ pnl: 200, pair: "GBPUSD" }),
      makeRow({ pnl: -30, pair: "GBPUSD" }),
    ];
    const r = perPairStats(trades);
    expect(r).toHaveLength(2);
    // Sorted by net PnL descending: EURUSD +50, GBPUSD +170 -> GBPUSD first
    expect(r[0]!.pair).toBe("GBPUSD");
    expect(r[0]!.netPnl).toBe(170);
    expect(r[0]!.winRate).toBeCloseTo(0.5, 6);
    expect(r[0]!.avgPnl).toBeCloseTo(85, 6);
    expect(r[1]!.pair).toBe("EURUSD");
    expect(r[1]!.netPnl).toBe(50);
  });

  it("counts pnl=0 as a loser (consistent with computeStats)", () => {
    const trades = [
      makeRow({ pnl: 0, pair: "EURUSD" }),
      makeRow({ pnl: 100, pair: "EURUSD" }),
    ];
    const r = perPairStats(trades);
    expect(r[0]!.winners).toBe(1);
    expect(r[0]!.losers).toBe(1);
    expect(r[0]!.winRate).toBeCloseTo(0.5, 6);
  });

  it("sorts by net PnL descending", () => {
    const trades = [
      makeRow({ pnl: -100, pair: "AUDUSD" }),
      makeRow({ pnl: 50, pair: "EURUSD" }),
      makeRow({ pnl: 200, pair: "GBPUSD" }),
    ];
    const r = perPairStats(trades);
    expect(r.map((p) => p.pair)).toEqual(["GBPUSD", "EURUSD", "AUDUSD"]);
  });
});

// ---------------------------------------------------------------------------
// perSessionStats
// ---------------------------------------------------------------------------

describe("perSessionStats", () => {
  it("returns empty for empty input", () => {
    expect(perSessionStats([])).toEqual([]);
  });

  it("groups by session with known order first, unspecified last", () => {
    const trades = [
      makeRow({ pnl: 100, session: "newyork" }),
      makeRow({ pnl: -50, session: "asian" }),
      makeRow({ pnl: 200, session: "london" }),
      makeRow({ pnl: -30, session: null }),
      makeRow({ pnl: 50, session: "overlap" }),
    ];
    const r = perSessionStats(trades);
    expect(r.map((s) => s.session)).toEqual([
      "asian",
      "london",
      "newyork",
      "overlap",
      "unspecified",
    ]);
  });

  it("computes win rate + net per session", () => {
    const trades = [
      makeRow({ pnl: 100, session: "london" }),
      makeRow({ pnl: -50, session: "london" }),
      makeRow({ pnl: 200, session: "newyork" }),
    ];
    const r = perSessionStats(trades);
    const london = r.find((s) => s.session === "london")!;
    expect(london.total).toBe(2);
    expect(london.winners).toBe(1);
    expect(london.losers).toBe(1);
    expect(london.netPnl).toBe(50);
    expect(london.winRate).toBeCloseTo(0.5, 6);
  });

  it("excludes open trades", () => {
    const trades = [
      makeRow({ pnl: 100, session: "london" }),
      makeRow({ pnl: null, session: "london" }),
    ];
    const r = perSessionStats(trades);
    expect(r).toHaveLength(1);
    expect(r[0]!.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// drawdownSeries
// ---------------------------------------------------------------------------

describe("drawdownSeries", () => {
  it("returns empty for empty input", () => {
    expect(drawdownSeries([])).toEqual([]);
  });

  it("excludes open trades", () => {
    const trades = [
      makeRow({ closed_at: null, pnl: null }),
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 100 }),
    ];
    expect(drawdownSeries(trades)).toHaveLength(1);
  });

  it("sorts by closed_at ascending", () => {
    const trades = [
      makeRow({ closed_at: "2026-01-03T00:00:00Z", pnl: -30 }),
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 100 }),
      makeRow({ closed_at: "2026-01-02T00:00:00Z", pnl: -50 }),
    ];
    const r = drawdownSeries(trades);
    expect(r[0]!.at).toBe("2026-01-01T00:00:00Z");
    expect(r[1]!.at).toBe("2026-01-02T00:00:00Z");
    expect(r[2]!.at).toBe("2026-01-03T00:00:00Z");
  });

  it("tracks running peak and computes drawdown", () => {
    // 100 -> -50 -> 200 -> -100
    // equity: 100, 50, 250, 150
    // peak:   100, 100, 250, 250
    // dd:     0, -50, 0, -100
    const trades = [
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 100 }),
      makeRow({ closed_at: "2026-01-02T00:00:00Z", pnl: -50 }),
      makeRow({ closed_at: "2026-01-03T00:00:00Z", pnl: 200 }),
      makeRow({ closed_at: "2026-01-04T00:00:00Z", pnl: -100 }),
    ];
    const r = drawdownSeries(trades);
    expect(r[0]).toMatchObject({ equity: 100, peak: 100, drawdown: 0 });
    expect(r[1]).toMatchObject({ equity: 50, peak: 100, drawdown: -50 });
    expect(r[2]).toMatchObject({ equity: 250, peak: 250, drawdown: 0 });
    expect(r[3]).toMatchObject({ equity: 150, peak: 250, drawdown: -100 });
  });

  it("drawdownPct is 0 when peak is 0", () => {
    // First trade loses -> peak stays 0, drawdownPct is 0.
    const trades = [
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: -50 }),
    ];
    const r = drawdownSeries(trades);
    expect(r[0]!.drawdownPct).toBe(0);
    expect(r[0]!.drawdown).toBe(-50);
  });

  it("computes drawdownPct correctly when peak > 0", () => {
    const trades = [
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 100 }), // peak 100
      makeRow({ closed_at: "2026-01-02T00:00:00Z", pnl: -30 }), // equity 70, peak 100, dd -30, pct -30%
    ];
    const r = drawdownSeries(trades);
    expect(r[1]!.drawdownPct).toBeCloseTo(-30, 6);
  });
});

// ---------------------------------------------------------------------------
// maxDrawdown
// ---------------------------------------------------------------------------

describe("maxDrawdown", () => {
  it("returns null for empty input", () => {
    expect(maxDrawdown([])).toBeNull();
  });

  it("returns the worst drawdown point by PERCENTAGE (not absolute)", () => {
    // equity: 100, 50, 250, 150
    // peak:   100, 100, 250, 250
    // drawdown:    0,  -50,   0, -100
    // drawdownPct: 0, -50%,   0, -40%
    // Worst percentage drawdown is -50% (point 2), NOT -40% (point 4).
    // In trading, "max drawdown" conventionally means worst peak-to-
    // trough percentage decline, not the largest absolute drop.
    const trades = [
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 100 }),
      makeRow({ closed_at: "2026-01-02T00:00:00Z", pnl: -50 }),
      makeRow({ closed_at: "2026-01-03T00:00:00Z", pnl: 200 }),
      makeRow({ closed_at: "2026-01-04T00:00:00Z", pnl: -100 }),
    ];
    const md = maxDrawdown(trades)!;
    expect(md.value).toBe(-50);
    expect(md.pct).toBeCloseTo(-50, 6); // -50 / 100 * 100
    expect(md.at).toBe("2026-01-02T00:00:00Z");
  });

  it("returns 0 drawdown when only winners", () => {
    const trades = [
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 100 }),
      makeRow({ closed_at: "2026-01-02T00:00:00Z", pnl: 50 }),
    ];
    const md = maxDrawdown(trades)!;
    expect(md.value).toBe(0);
    expect(md.pct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pnlDistribution
// ---------------------------------------------------------------------------

describe("pnlDistribution", () => {
  it("returns empty for empty input", () => {
    expect(pnlDistribution([])).toEqual([]);
  });

  it("buckets trades by pnl range", () => {
    const trades = [
      makeRow({ pnl: 25 }),
      makeRow({ pnl: 75 }),
      makeRow({ pnl: -25 }),
    ];
    const buckets = pnlDistribution(trades, 50);
    // Buckets from -$50 to $100 in $50 steps
    expect(buckets.length).toBeGreaterThanOrEqual(3);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(3);
  });

  it("places trades in the correct bucket", () => {
    const trades = [
      makeRow({ pnl: 10 }),
      makeRow({ pnl: 60 }),
      makeRow({ pnl: 110 }),
    ];
    const buckets = pnlDistribution(trades, 50);
    // Find buckets containing 10, 60, 110
    const b10 = buckets.find((b) => b.from <= 10 && 10 < b.to)!;
    const b60 = buckets.find((b) => b.from <= 60 && 60 < b.to)!;
    const b110 = buckets.find((b) => b.from <= 110 && 110 < b.to)!;
    expect(b10.count).toBe(1);
    expect(b60.count).toBe(1);
    expect(b110.count).toBe(1);
  });

  it("picks a sensible default bucket size from range", () => {
    const trades = [
      makeRow({ pnl: -200 }),
      makeRow({ pnl: 800 }),
    ];
    // Range = 1000, expected ~10 buckets of size 100 each (or 200)
    const buckets = pnlDistribution(trades);
    expect(buckets.length).toBeGreaterThanOrEqual(5);
    expect(buckets.length).toBeLessThanOrEqual(15);
  });

  it("excludes open trades", () => {
    const trades = [
      makeRow({ pnl: 50 }),
      makeRow({ pnl: null }),
    ];
    const buckets = pnlDistribution(trades, 50);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// perWeekdayStats
// ---------------------------------------------------------------------------

describe("perWeekdayStats", () => {
  it("returns 7 buckets in day order (Sun..Sat)", () => {
    const r = perWeekdayStats([]);
    expect(r).toHaveLength(7);
    expect(r.map((b) => b.label)).toEqual([
      "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
    ]);
  });

  it("returns 0 totals for empty input", () => {
    const r = perWeekdayStats([]);
    expect(r.every((b) => b.total === 0)).toBe(true);
  });

  it("groups by weekday of closed_at", () => {
    // 2026-01-05 is a Monday (day 1)
    // 2026-01-07 is a Wednesday (day 3)
    // 2026-01-09 is a Friday (day 5)
    const trades = [
      makeRow({ pnl: 100, closed_at: "2026-01-05T12:00:00Z" }),
      makeRow({ pnl: -50, closed_at: "2026-01-07T12:00:00Z" }),
      makeRow({ pnl: 200, closed_at: "2026-01-09T12:00:00Z" }),
    ];
    const r = perWeekdayStats(trades);
    expect(r[1]!.total).toBe(1); // Mon
    expect(r[1]!.netPnl).toBe(100);
    expect(r[3]!.total).toBe(1); // Wed
    expect(r[3]!.netPnl).toBe(-50);
    expect(r[5]!.total).toBe(1); // Fri
    expect(r[5]!.netPnl).toBe(200);
    expect(r[0]!.total).toBe(0); // Sun
  });

  it("excludes trades without closed_at", () => {
    const trades = [
      makeRow({ pnl: 100, closed_at: null }),
      makeRow({ pnl: 100, closed_at: "2026-01-05T12:00:00Z" }),
    ];
    const r = perWeekdayStats(trades);
    const total = r.reduce((s, b) => s + b.total, 0);
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// analyticsSummary
// ---------------------------------------------------------------------------

describe("analyticsSummary", () => {
  it("returns nulls and zeros for empty input", () => {
    const s = analyticsSummary([]);
    expect(s.bestPair).toBeNull();
    expect(s.worstPair).toBeNull();
    expect(s.maxDrawdown).toBeNull();
    expect(s.longestWinStreak).toBe(0);
    expect(s.longestLossStreak).toBe(0);
    expect(s.avgHoldMinutes).toBeNull();
    expect(s.closedCount).toBe(0);
  });

  it("identifies best and worst pair by net PnL", () => {
    const trades = [
      makeRow({ pnl: 200, pair: "GBPUSD" }),
      makeRow({ pnl: -100, pair: "AUDUSD" }),
      makeRow({ pnl: 50, pair: "EURUSD" }),
    ];
    const s = analyticsSummary(trades);
    expect(s.bestPair).toEqual({ pair: "GBPUSD", netPnl: 200 });
    expect(s.worstPair).toEqual({ pair: "AUDUSD", netPnl: -100 });
  });

  it("computes longest win + loss streaks", () => {
    // W W L W W W L L
    const trades = [
      makeRow({ pnl: 10, closed_at: "2026-01-01T00:00:00Z" }),
      makeRow({ pnl: 10, closed_at: "2026-01-02T00:00:00Z" }),
      makeRow({ pnl: -10, closed_at: "2026-01-03T00:00:00Z" }),
      makeRow({ pnl: 10, closed_at: "2026-01-04T00:00:00Z" }),
      makeRow({ pnl: 10, closed_at: "2026-01-05T00:00:00Z" }),
      makeRow({ pnl: 10, closed_at: "2026-01-06T00:00:00Z" }),
      makeRow({ pnl: -10, closed_at: "2026-01-07T00:00:00Z" }),
      makeRow({ pnl: -10, closed_at: "2026-01-08T00:00:00Z" }),
    ];
    const s = analyticsSummary(trades);
    expect(s.longestWinStreak).toBe(3);
    expect(s.longestLossStreak).toBe(2);
  });

  it("computes average holding time in minutes", () => {
    const trades = [
      // Open 08:00, close 10:00 -> 120 min
      makeRow({
        opened_at: "2026-01-01T08:00:00Z",
        closed_at: "2026-01-01T10:00:00Z",
        pnl: 10,
      }),
      // Open 08:00, close 09:30 -> 90 min
      makeRow({
        opened_at: "2026-01-02T08:00:00Z",
        closed_at: "2026-01-02T09:30:00Z",
        pnl: -5,
      }),
    ];
    const s = analyticsSummary(trades);
    expect(s.avgHoldMinutes).toBeCloseTo(105, 6); // (120 + 90) / 2
  });

  it("skips trades with missing timestamps for avg holding time", () => {
    const trades = [
      makeRow({
        opened_at: "2026-01-01T08:00:00Z",
        closed_at: "2026-01-01T10:00:00Z",
        pnl: 10,
      }),
      makeRow({
        opened_at: "",
        closed_at: "2026-01-02T10:00:00Z",
        pnl: 10,
      }),
    ];
    const s = analyticsSummary(trades);
    expect(s.avgHoldMinutes).toBe(120);
  });

  it("closedCount excludes open trades", () => {
    const trades = [
      makeRow({ pnl: 100 }),
      makeRow({ pnl: null }),
    ];
    const s = analyticsSummary(trades);
    expect(s.closedCount).toBe(1);
  });

  it("computes maxDrawdown as worst PERCENTAGE drawdown", () => {
    // equity: 100, 50, 250, 150
    // drawdownPct: 0, -50%, 0, -40%  -> worst is -50% (point 2)
    const trades = [
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 100 }),
      makeRow({ closed_at: "2026-01-02T00:00:00Z", pnl: -50 }),
      makeRow({ closed_at: "2026-01-03T00:00:00Z", pnl: 200 }),
      makeRow({ closed_at: "2026-01-04T00:00:00Z", pnl: -100 }),
    ];
    const s = analyticsSummary(trades);
    expect(s.maxDrawdown).not.toBeNull();
    expect(s.maxDrawdown!.value).toBe(-50);
    expect(s.maxDrawdown!.pct).toBeCloseTo(-50, 6);
  });
});
