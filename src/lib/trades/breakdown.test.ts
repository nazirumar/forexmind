import { describe, expect, it } from "vitest";
import { breakdown, breakdownInsight, NO_VALUE } from "@/lib/trades/breakdown";
import type { TradeRow } from "@/lib/trades/schema";
import { tradeRowSchema } from "@/lib/trades/schema";

/** Build a minimal valid TradeRow with overridable fields. */
function trade(overrides: Partial<TradeRow> & Pick<TradeRow, "pair">): TradeRow {
  return tradeRowSchema.parse({
    id: overrides.id ?? crypto.randomUUID(),
    user_id: "00000000-0000-0000-0000-000000000000",
    direction: "buy",
    entry_price: 1.0,
    exit_price: null,
    stop_loss: 0.99,
    take_profit: null,
    lot_size: 0.1,
    opened_at: new Date("2026-01-01T09:00:00Z").toISOString(),
    closed_at: null,
    followed_plan: true,
    notes: null,
    strategy: null,
    session: null,
    emotion: null,
    tags: [],
    created_at: new Date("2026-01-01T09:00:00Z").toISOString(),
    ...overrides,
  });
}

describe("breakdown", () => {
  it("groups by session and computes win rate / net pnl", () => {
    const trades = [
      trade({ pair: "EURUSD", session: "london", pnl: 100 }),
      trade({ pair: "EURUSD", session: "london", pnl: -50 }),
      trade({ pair: "GBPUSD", session: "newyork", pnl: -30 }),
      trade({ pair: "GBPUSD", session: "newyork", pnl: -30 }),
    ];
    const groups = breakdown(trades, "session");
    expect(groups).toHaveLength(2);

    // london: 2 closed, 1W/1L, net +50 -> listed first (tie on closed, higher pnl)
    const london = groups[0];
    expect(london.key).toBe("london");
    expect(london.total).toBe(2);
    expect(london.closed).toBe(2);
    expect(london.winners).toBe(1);
    expect(london.losers).toBe(1);
    expect(london.winRate).toBeCloseTo(0.5);
    expect(london.netPnl).toBeCloseTo(50);
    expect(london.profitFactor).toBeCloseTo(2);

    const ny = groups[1];
    expect(ny.key).toBe("newyork");
    expect(ny.winRate).toBe(0);
    expect(ny.netPnl).toBeCloseTo(-60);
    // no winners -> profit factor undefined
    expect(ny.profitFactor).toBeNull();
  });

  it("puts unclosed/open trades in total but not in closed stats", () => {
    const trades = [
      trade({ pair: "USDJPY", strategy: "breakout", pnl: 80, r_multiple: 1.6 }),
      trade({ pair: "USDJPY", strategy: "breakout", pnl: null, r_multiple: null }),
    ];
    const [g] = breakdown(trades, "strategy");
    expect(g.key).toBe("breakout");
    expect(g.total).toBe(2);
    expect(g.closed).toBe(1);
    expect(g.winRate).toBe(1);
    expect(g.avgR).toBeCloseTo(1.6);
  });

  it("averages r_multiple only over trades that have one", () => {
    const trades = [
      trade({ pair: "EURUSD", emotion: "calm", pnl: 100, r_multiple: 2 }),
      trade({ pair: "EURUSD", emotion: "calm", pnl: 50, r_multiple: 1 }),
      trade({ pair: "EURUSD", emotion: "calm", pnl: -40, r_multiple: null }),
    ];
    const [g] = breakdown(trades, "emotion");
    expect(g.avgR).toBeCloseTo(1.5);
  });

  it("groups empty/null dimension values under NO_VALUE", () => {
    const trades = [
      trade({ pair: "EURUSD", emotion: null, pnl: 10 }),
      trade({ pair: "EURUSD", emotion: "   ", pnl: 20 }),
    ];
    const [g] = breakdown(trades, "emotion");
    expect(g.key).toBe(NO_VALUE);
    expect(g.total).toBe(2);
  });

  it("returns [] for empty input", () => {
    expect(breakdown([], "pair")).toEqual([]);
  });

  it("handles the all-losers group (profit factor null, win rate 0)", () => {
    const trades = [
      trade({ pair: "XAUUSD", mistake_type: "revenge", pnl: -100 }),
      trade({ pair: "XAUUSD", mistake_type: "revenge", pnl: 0 }),
    ];
    const [g] = breakdown(trades, "mistakeType");
    expect(g.winners).toBe(0);
    expect(g.winRate).toBe(0);
    expect(g.profitFactor).toBeNull();
  });
});

describe("breakdownInsight", () => {
  const base = { pair: "EURUSD", pnl: 10, r_multiple: 1 };

  it("returns best/worst by avg R with enough sample", () => {
    const trades = [
      trade({ ...base, session: "london", r_multiple: 2 }),
      trade({ ...base, session: "london", r_multiple: 2 }),
      trade({ ...base, session: "london", r_multiple: 2 }),
      trade({ ...base, session: "asian", r_multiple: -1 }),
      trade({ ...base, session: "asian", r_multiple: -1 }),
      trade({ ...base, session: "asian", r_multiple: -1 }),
    ];
    const insight = breakdownInsight(breakdown(trades, "session"));
    expect(insight).not.toBeNull();
    expect(insight!.best.key).toBe("london");
    expect(insight!.worst.key).toBe("asian");
  });

  it("ignores groups below minTrades", () => {
    const trades = [
      trade({ ...base, session: "london", r_multiple: 2 }),
      trade({ ...base, session: "asian", r_multiple: -1 }),
      trade({ ...base, session: "asian", r_multiple: -1 }),
      trade({ ...base, session: "asian", r_multiple: -1 }),
    ];
    const insight = breakdownInsight(breakdown(trades, "session"));
    // london (1 trade) filtered out; only one qualified group -> null
    expect(insight).toBeNull();
  });

  it("returns null when every trade lacks R data", () => {
    const trades = [
      trade({ pair: "EURUSD", session: "london", pnl: 10 }),
      trade({ pair: "EURUSD", session: "asian", pnl: -10 }),
    ];
    expect(breakdownInsight(breakdown(trades, "session"))).toBeNull();
  });
});
