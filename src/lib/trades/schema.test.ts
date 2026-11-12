/**
 * Tests for the pure stats helpers in src/lib/trades/schema.ts.
 *
 * These run against the in-memory TradeRow shape, no DB / Supabase.
 * The query layer that fetches rows is exercised separately via
 * the API curl tests at the end of Phase 5.
 */
import { describe, it, expect } from "vitest";
import {
  computeStats,
  equityCurve,
  tradeCreateSchema,
  tradeUpdateSchema,
  formatMoney,
  formatPct,
  formatRatio,
  formatPair,
  timeAgo,
  type TradeRow,
} from "@/lib/trades/schema";

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

describe("computeStats - empty input", () => {
  it("returns zeros for an empty list", () => {
    const s = computeStats([]);
    expect(s.total).toBe(0);
    expect(s.closed).toBe(0);
    expect(s.winners).toBe(0);
    expect(s.losers).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.netPnl).toBe(0);
    expect(s.profitFactor).toBeNaN();
    expect(s.avgPnl).toBe(0);
  });
});

describe("computeStats - mixed trades", () => {
  const trades: TradeRow[] = [
    makeRow({ pnl: 200 }), // winner
    makeRow({ pnl: -100 }), // loser
    makeRow({ pnl: 50 }), // winner
    makeRow({ pnl: null }), // open trade - excluded
    makeRow({ pnl: -25, followed_plan: false }), // loser, broke plan
  ];

  const s = computeStats(trades);

  it("counts totals correctly", () => {
    expect(s.total).toBe(5);
    expect(s.closed).toBe(4);
    expect(s.winners).toBe(2);
    expect(s.losers).toBe(2);
  });

  it("computes win rate = winners / closed", () => {
    expect(s.winRate).toBeCloseTo(0.5, 6);
  });

  it("sums gross profit and loss", () => {
    expect(s.grossProfit).toBe(250);
    expect(s.grossLoss).toBe(-125);
    expect(s.netPnl).toBe(125);
  });

  it("computes profit factor = grossProfit / |grossLoss|", () => {
    expect(s.profitFactor).toBeCloseTo(250 / 125, 6);
  });

  it("averages correctly", () => {
    expect(s.avgPnl).toBeCloseTo(125 / 4, 6);
    expect(s.avgWin).toBeCloseTo(125, 6);
    expect(s.avgLoss).toBeCloseTo(-62.5, 6);
  });

  it("counts broke-plan trades", () => {
    expect(s.brokePlanCount).toBe(1);
  });

  it("sums all lots including open trades", () => {
    expect(s.totalLots).toBe(2.5); // 0.5 * 5
  });
});

describe("computeStats - edge cases", () => {
  it("all winners -> profitFactor is NaN (no losers to divide by)", () => {
    const trades = [makeRow({ pnl: 100 }), makeRow({ pnl: 200 })];
    const s = computeStats(trades);
    expect(s.winners).toBe(2);
    expect(s.losers).toBe(0);
    expect(s.profitFactor).toBeNaN();
    expect(s.netPnl).toBe(300);
  });

  it("all losers -> profit factor is 0 (no winners)", () => {
    const trades = [makeRow({ pnl: -100 }), makeRow({ pnl: -200 })];
    const s = computeStats(trades);
    expect(s.winners).toBe(0);
    expect(s.losers).toBe(2);
    expect(s.profitFactor).toBe(0);
    expect(s.netPnl).toBe(-300);
  });

  it("pnl = 0 counts as a loser (breakeven doesn't inflate win rate)", () => {
    const trades = [makeRow({ pnl: 0 }), makeRow({ pnl: 100 })];
    const s = computeStats(trades);
    expect(s.winners).toBe(1);
    expect(s.losers).toBe(1);
    expect(s.winRate).toBeCloseTo(0.5, 6);
  });

  it("non-finite pnl is ignored", () => {
    const trades = [
      makeRow({ pnl: Number.NaN }),
      makeRow({ pnl: 100 }),
    ];
    const s = computeStats(trades);
    expect(s.closed).toBe(1);
    expect(s.winners).toBe(1);
  });
});

describe("equityCurve", () => {
  it("returns a single 0 point when no closed trades", () => {
    const out = equityCurve([]);
    expect(out).toHaveLength(1);
    expect(out[0].equity).toBe(0);
  });

  it("sorts by closed_at ascending", () => {
    const trades = [
      makeRow({ closed_at: "2026-01-02T00:00:00Z", pnl: 100 }),
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 50 }),
      makeRow({ closed_at: "2026-01-03T00:00:00Z", pnl: -30 }),
    ];
    const out = equityCurve(trades);
    expect(out).toHaveLength(4); // 0 baseline + 3 points
    expect(out[1].at).toBe("2026-01-01T00:00:00Z");
    expect(out[2].at).toBe("2026-01-02T00:00:00Z");
    expect(out[3].at).toBe("2026-01-03T00:00:00Z");
  });

  it("accumulates equity correctly", () => {
    const trades = [
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 100 }),
      makeRow({ closed_at: "2026-01-02T00:00:00Z", pnl: -30 }),
      makeRow({ closed_at: "2026-01-03T00:00:00Z", pnl: 80 }),
    ];
    const out = equityCurve(trades);
    expect(out[1].equity).toBe(100);
    expect(out[2].equity).toBe(70);
    expect(out[3].equity).toBe(150);
  });

  it("excludes open trades (no closed_at)", () => {
    const trades = [
      makeRow({ closed_at: null, pnl: null }), // open
      makeRow({ closed_at: "2026-01-01T00:00:00Z", pnl: 100 }),
    ];
    const out = equityCurve(trades);
    expect(out).toHaveLength(2);
    expect(out[1].equity).toBe(100);
  });
});

describe("tradeCreateSchema - validation", () => {
  const valid = {
    pair: "EURUSD",
    direction: "buy" as const,
    entry_price: 1.085,
    stop_loss: 1.08,
    lot_size: 0.5,
    opened_at: "2026-01-01T08:00:00Z",
    followed_plan: true,
  };

  it("accepts a minimal valid trade", () => {
    const r = tradeCreateSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.pair).toBe("EURUSD");
      expect(r.data.exit_price).toBeUndefined();
      expect(r.data.followed_plan).toBe(true);
    }
  });

  it("normalizes pair case and slash", () => {
    const r = tradeCreateSchema.safeParse({ ...valid, pair: "eur/usd" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pair).toBe("EURUSD");
  });

  it("rejects unsupported pair", () => {
    const r = tradeCreateSchema.safeParse({ ...valid, pair: "BTCUSD" });
    expect(r.success).toBe(false);
  });

  it("rejects zero entry price", () => {
    const r = tradeCreateSchema.safeParse({ ...valid, entry_price: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects negative lot size", () => {
    const r = tradeCreateSchema.safeParse({ ...valid, lot_size: -0.5 });
    expect(r.success).toBe(false);
  });

  it("rejects close time before open time", () => {
    const r = tradeCreateSchema.safeParse({
      ...valid,
      closed_at: "2025-12-31T00:00:00Z",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toContain("closed_at");
    }
  });

  it("accepts empty string for closed_at and converts to null", () => {
    const r = tradeCreateSchema.safeParse({ ...valid, closed_at: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.closed_at).toBeNull();
  });

  it("accepts nullable exit_price and take_profit", () => {
    const r = tradeCreateSchema.safeParse({
      ...valid,
      exit_price: null,
      take_profit: null,
      pnl: null,
      strategy: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.exit_price).toBeNull();
      expect(r.data.strategy).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });

  it("rejects invalid direction", () => {
    const r = tradeCreateSchema.safeParse({
      ...valid,
      direction: "long",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid session", () => {
    const r = tradeCreateSchema.safeParse({
      ...valid,
      session: "tokyo" as unknown as "asian",
    });
    expect(r.success).toBe(false);
  });

  it("defaults followed_plan to true when omitted", () => {
    const r = tradeCreateSchema.safeParse({
      pair: "EURUSD",
      direction: "buy",
      entry_price: 1.085,
      stop_loss: 1.08,
      lot_size: 0.5,
      opened_at: "2026-01-01T08:00:00Z",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.followed_plan).toBe(true);
  });

  it("rejects notes over 4000 chars", () => {
    const r = tradeCreateSchema.safeParse({
      ...valid,
      notes: "x".repeat(4001),
    });
    expect(r.success).toBe(false);
  });
});

describe("tradeUpdateSchema - partial validation", () => {
  it("accepts an empty object", () => {
    const r = tradeUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts a single field", () => {
    const r = tradeUpdateSchema.safeParse({ pnl: 123 });
    expect(r.success).toBe(true);
  });

  it("rejects invalid single field", () => {
    const r = tradeUpdateSchema.safeParse({ lot_size: -1 });
    expect(r.success).toBe(false);
  });
});

describe("formatters", () => {
  it("formatMoney formats positive, negative and null", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(-1234.5)).toBe("-$1,234.50");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
  });

  it("formatPct multiplies by 100 and adds %", () => {
    expect(formatPct(0.5)).toBe("50.0%");
    expect(formatPct(0.3333, 2)).toBe("33.33%");
    expect(formatPct(null)).toBe("—");
  });

  it("formatRatio shows 2 decimals", () => {
    expect(formatRatio(2.5)).toBe("2.50");
    expect(formatRatio(Number.NaN)).toBe("—");
  });

  it("formatPair inserts a slash between ccy codes", () => {
    expect(formatPair("EURUSD")).toBe("EUR/USD");
    expect(formatPair("eur/usd")).toBe("EUR/USD");
    expect(formatPair("XAUUSD")).toBe("XAU/USD");
  });

  it("timeAgo returns 'just now' for recent timestamps", () => {
    expect(timeAgo(new Date().toISOString())).toBe("just now");
    expect(timeAgo(null)).toBe("—");
  });
});
