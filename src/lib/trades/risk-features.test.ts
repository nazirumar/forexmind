/**
 * Tests for the new risk-management + exposure + dimension analytics
 * added in the risk-foundation feature set.
 *
 * Covers:
 *  - computeRMultiple / plannedRMultiple (risk.ts)
 *  - rExpectancy, rDistribution, rEquityCurve, rStats, checkLossLimits (risk-analytics.ts)
 *  - netExposureByCurrency, correlatedExposure, exposureSummary (exposure.ts)
 *  - perTimeframeStats, perStrategyStats, perHourStats (analytics.ts)
 *
 * Pure, in-memory, no DB.
 */
import { describe, it, expect } from "vitest";
import { computeRMultiple, plannedRMultiple } from "@/lib/risk";
import {
  rExpectancy,
  rDistribution,
  rEquityCurve,
  rStats,
  withRMultiples,
  checkLossLimits,
} from "@/lib/trades/risk-analytics";
import {
  netExposureByCurrency,
  correlatedExposure,
  exposureSummary,
} from "@/lib/trades/exposure";
import {
  perTimeframeStats,
  perStrategyStats,
  perHourStats,
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
// computeRMultiple
// ---------------------------------------------------------------------------

describe("computeRMultiple", () => {
  it("returns null when pnl or risk_amount is missing", () => {
    expect(computeRMultiple(null, 100)).toBeNull();
    expect(computeRMultiple(100, null)).toBeNull();
    expect(computeRMultiple(undefined, undefined)).toBeNull();
  });

  it("returns null when risk_amount <= 0 (no-stop trade)", () => {
    expect(computeRMultiple(100, 0)).toBeNull();
    expect(computeRMultiple(-50, -10)).toBeNull();
  });

  it("computes realized R = pnl / risk_amount", () => {
    expect(computeRMultiple(200, 100)).toBe(2);
    expect(computeRMultiple(-100, 100)).toBe(-1);
    expect(computeRMultiple(50, 25)).toBe(2);
    expect(computeRMultiple(-37.5, 75)).toBe(-0.5);
  });
});

describe("plannedRMultiple", () => {
  it("equals riskRewardRatio", () => {
    expect(plannedRMultiple(30, 60)).toBe(2);
    expect(plannedRMultiple(40, 20)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// R-multiple aggregates (risk-analytics.ts)
// ---------------------------------------------------------------------------

describe("withRMultiples", () => {
  it("attaches R to closed trades with risk_amount, drops the rest", () => {
    const trades = [
      makeRow({ pnl: 200, risk_amount: 100, closed_at: "2026-01-01T12:00:00Z" }),
      makeRow({ pnl: -50, risk_amount: null, closed_at: "2026-01-02T12:00:00Z" }), // no risk
      makeRow({ pnl: null, risk_amount: 100, closed_at: "2026-01-03T12:00:00Z" }), // no pnl
      makeRow({ pnl: -100, risk_amount: 100, closed_at: null }), // no closed_at
    ];
    const rs = withRMultiples(trades);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.r).toBe(2);
  });

  it("sorts by closed_at ascending", () => {
    const trades = [
      makeRow({ pnl: 100, risk_amount: 100, closed_at: "2026-01-05T12:00:00Z" }),
      makeRow({ pnl: -100, risk_amount: 100, closed_at: "2026-01-01T12:00:00Z" }),
    ];
    const rs = withRMultiples(trades);
    expect(rs[0]!.closedAt).toBe("2026-01-01T12:00:00Z");
    expect(rs[1]!.closedAt).toBe("2026-01-05T12:00:00Z");
  });
});

describe("rExpectancy", () => {
  it("returns zeroes when no R data", () => {
    const e = rExpectancy([makeRow({ pnl: 100, risk_amount: null })]);
    expect(e.count).toBe(0);
    expect(e.expectancyR).toBe(0);
  });

  it("computes expectancy = winRate*avgWin + lossRate*avgLoss", () => {
    // 2 winners (+2R, +1R), 2 losers (-1R, -1R) => winRate 0.5
    // avgWin = 1.5, avgLoss = -1 => expectancy = 0.5*1.5 + 0.5*(-1) = 0.25
    const trades = [
      makeRow({ pnl: 200, risk_amount: 100, closed_at: "2026-01-01T12:00:00Z" }),
      makeRow({ pnl: 100, risk_amount: 100, closed_at: "2026-01-02T12:00:00Z" }),
      makeRow({ pnl: -100, risk_amount: 100, closed_at: "2026-01-03T12:00:00Z" }),
      makeRow({ pnl: -100, risk_amount: 100, closed_at: "2026-01-04T12:00:00Z" }),
    ];
    const e = rExpectancy(trades);
    expect(e.count).toBe(4);
    expect(e.winRate).toBe(0.5);
    expect(e.avgWinR).toBe(1.5);
    expect(e.avgLossR).toBe(-1);
    expect(e.expectancyR).toBeCloseTo(0.25, 10);
  });
});

describe("rDistribution", () => {
  it("returns empty when no R data", () => {
    expect(rDistribution([])).toEqual([]);
  });

  it("buckets R values into 0.5R bins", () => {
    const trades = [
      makeRow({ pnl: 200, risk_amount: 100, closed_at: "2026-01-01T12:00:00Z" }), // +2R
      makeRow({ pnl: -100, risk_amount: 100, closed_at: "2026-01-02T12:00:00Z" }), // -1R
      makeRow({ pnl: -150, risk_amount: 100, closed_at: "2026-01-03T12:00:00Z" }), // -1.5R
    ];
    const buckets = rDistribution(trades);
    // Sum of counts equals number of trades.
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(3);
  });
});

describe("rEquityCurve", () => {
  it("starts at 0 and accumulates R", () => {
    const trades = [
      makeRow({ pnl: 100, risk_amount: 100, closed_at: "2026-01-01T12:00:00Z" }), // +1R
      makeRow({ pnl: 200, risk_amount: 100, closed_at: "2026-01-02T12:00:00Z" }), // +2R
    ];
    const curve = rEquityCurve(trades);
    expect(curve[0]!.rEquity).toBe(0);
    expect(curve[1]!.rEquity).toBe(1);
    expect(curve[2]!.rEquity).toBe(3);
  });
});

describe("rStats", () => {
  it("detects blown stops (trades worse than -1R)", () => {
    const trades = [
      makeRow({ pnl: 200, risk_amount: 100, closed_at: "2026-01-01T12:00:00Z" }), // +2R winner
      makeRow({ pnl: -100, risk_amount: 100, closed_at: "2026-01-02T12:00:00Z" }), // -1R full loss
      makeRow({ pnl: -150, risk_amount: 100, closed_at: "2026-01-03T12:00:00Z" }), // -1.5R blown
    ];
    const s = rStats(trades);
    expect(s.fullWinners).toBe(1);
    expect(s.fullLosers).toBe(1);
    expect(s.blownStops).toBe(1);
    expect(s.bestR).toBe(2);
    expect(s.worstR).toBe(-1.5);
    expect(s.totalR).toBeCloseTo(-0.5, 10);
  });
});

describe("checkLossLimits", () => {
  it("flags when daily loss exceeds the % limit", () => {
    const today = new Date();
    today.setUTCHours(6, 0, 0, 0);
    const trades = [
      makeRow({
        pnl: -300,
        risk_amount: 100,
        closed_at: today.toISOString(),
      }),
    ];
    const status = checkLossLimits(trades, {
      maxDailyLossPct: 2,
      balanceForPct: 10000, // limit = $200
    });
    expect(status.todayPnl).toBe(-300);
    expect(status.dailyLimitHit).toBe(true);
    expect(status.warning).toContain("Daily loss limit");
  });

  it("flags when max trades/day is reached", () => {
    const today = new Date();
    today.setUTCHours(6, 0, 0, 0);
    const trades = [
      makeRow({ pnl: 10, closed_at: today.toISOString() }),
      makeRow({ pnl: 10, closed_at: today.toISOString() }),
      makeRow({ pnl: 10, closed_at: today.toISOString() }),
    ];
    const status = checkLossLimits(trades, { maxTradesPerDay: 3 });
    expect(status.todayTrades).toBe(3);
    expect(status.warning).toContain("Max trades/day");
  });

  it("no warning when all clear", () => {
    const status = checkLossLimits([], { maxDailyLossPct: 2, balanceForPct: 10000 });
    expect(status.warning).toBeNull();
    expect(status.todayTrades).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Exposure (exposure.ts)
// ---------------------------------------------------------------------------

describe("netExposureByCurrency", () => {
  it("computes net long/short per currency from open trades only", () => {
    const trades = [
      makeRow({ pair: "EURUSD", direction: "buy", lot_size: 1, closed_at: null, pnl: null }),
      makeRow({ pair: "GBPUSD", direction: "sell", lot_size: 0.5, closed_at: null, pnl: null }),
      // closed trade should not count:
      makeRow({ pair: "EURUSD", direction: "buy", lot_size: 5, closed_at: "2026-01-01T12:00:00Z", pnl: 100 }),
    ];
    const exp = netExposureByCurrency(trades);
    const eur = exp.find((e) => e.currency === "EUR");
    const usd = exp.find((e) => e.currency === "USD");
    const gbp = exp.find((e) => e.currency === "GBP");
    expect(eur?.netLots).toBe(1); // +1 from the EURUSD buy
    expect(gbp?.netLots).toBe(-0.5); // -0.5 from GBPUSD sell (short base)
    expect(usd?.netLots).toBeCloseTo(-0.5, 10); // -1 (EURUSD buy short USD) + 0.5 (GBPUSD sell long USD)
  });

  it("returns empty when all trades closed", () => {
    const trades = [makeRow({ closed_at: "2026-01-01T12:00:00Z", pnl: 100 })];
    expect(netExposureByCurrency(trades)).toEqual([]);
  });
});

describe("correlatedExposure", () => {
  it("flags same-direction trades on highly-correlated pairs", () => {
    const trades = [
      makeRow({ pair: "EURUSD", direction: "buy", lot_size: 1, closed_at: null, pnl: null }),
      makeRow({ pair: "GBPUSD", direction: "buy", lot_size: 1, closed_at: null, pnl: null }), // corr 0.88
    ];
    const warnings = correlatedExposure(trades);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]!.correlation).toBeGreaterThan(0.6);
  });

  it("does not flag uncorrelated pairs", () => {
    const trades = [
      makeRow({ pair: "EURUSD", direction: "buy", lot_size: 1, closed_at: null, pnl: null }),
      makeRow({ pair: "AUDCAD", direction: "buy", lot_size: 1, closed_at: null, pnl: null }),
    ];
    expect(correlatedExposure(trades)).toEqual([]);
  });
});

describe("exposureSummary", () => {
  it("aggregates open count + lots + risk", () => {
    const trades = [
      makeRow({ pair: "EURUSD", lot_size: 1, risk_amount: 100, closed_at: null, pnl: null }),
      makeRow({ pair: "GBPUSD", lot_size: 0.5, risk_amount: 50, closed_at: null, pnl: null }),
    ];
    const s = exposureSummary(trades);
    expect(s.openCount).toBe(2);
    expect(s.totalOpenLots).toBe(1.5);
    expect(s.totalOpenRisk).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Dimension analytics (analytics.ts)
// ---------------------------------------------------------------------------

describe("perTimeframeStats", () => {
  it("groups closed trades by timeframe", () => {
    const trades = [
      makeRow({ pnl: 100, timeframe: "H1", closed_at: "2026-01-01T12:00:00Z" }),
      makeRow({ pnl: -50, timeframe: "H1", closed_at: "2026-01-02T12:00:00Z" }),
      makeRow({ pnl: 200, timeframe: "M5", closed_at: "2026-01-03T12:00:00Z" }),
    ];
    const stats = perTimeframeStats(trades);
    const h1 = stats.find((s) => s.timeframe === "H1");
    const m5 = stats.find((s) => s.timeframe === "M5");
    expect(h1?.total).toBe(2);
    expect(h1?.winners).toBe(1);
    expect(h1?.netPnl).toBe(50);
    expect(m5?.total).toBe(1);
  });

  it("puts trades with no timeframe in unspecified", () => {
    const trades = [makeRow({ pnl: 100, timeframe: null, closed_at: "2026-01-01T12:00:00Z" })];
    const stats = perTimeframeStats(trades);
    expect(stats[0]?.timeframe).toBe("unspecified");
  });
});

describe("perStrategyStats", () => {
  it("groups by strategy and sorts by net PnL desc", () => {
    const trades = [
      makeRow({ pnl: 300, strategy: "breakout", closed_at: "2026-01-01T12:00:00Z" }),
      makeRow({ pnl: 100, strategy: "fade", closed_at: "2026-01-02T12:00:00Z" }),
      makeRow({ pnl: -50, strategy: "breakout", closed_at: "2026-01-03T12:00:00Z" }),
    ];
    const stats = perStrategyStats(trades);
    expect(stats[0]?.strategy).toBe("breakout");
    expect(stats[0]?.netPnl).toBe(250);
    expect(stats[1]?.strategy).toBe("fade");
  });

  it("skips trades with no strategy", () => {
    const trades = [makeRow({ pnl: 100, strategy: null, closed_at: "2026-01-01T12:00:00Z" })];
    expect(perStrategyStats(trades)).toEqual([]);
  });
});

describe("perHourStats", () => {
  it("returns 24 buckets in hour order", () => {
    const stats = perHourStats([]);
    expect(stats).toHaveLength(24);
    expect(stats[0]?.hour).toBe(0);
    expect(stats[23]?.hour).toBe(23);
  });

  it("assigns trades to the UTC hour they opened", () => {
    // opened at 08:00 UTC
    const trades = [makeRow({ pnl: 100, opened_at: "2026-01-01T08:30:00Z", closed_at: "2026-01-01T12:00:00Z" })];
    const stats = perHourStats(trades);
    expect(stats[8]?.total).toBe(1);
    expect(stats[8]?.netPnl).toBe(100);
    expect(stats[7]?.total).toBe(0);
  });
});
