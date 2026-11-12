/**
 * Tests for the report data preparation (Phase 25).
 */
import { describe, it, expect } from "vitest";
import { buildReportData, formatSummaryLines } from "@/lib/report/data";
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
    opened_at: "2026-01-15T08:00:00Z",
    closed_at: "2026-01-15T12:00:00Z",
    pnl: 0,
    strategy: "trend",
    session: "london",
    emotion: null,
    followed_plan: true,
    notes: null,
    created_at: "2026-01-15T08:00:00Z",
    tags: [],
    ...overrides,
  };
}

describe("buildReportData", () => {
  it("returns a summary with zeros for empty input", () => {
    const data = buildReportData([], "2026-01-09", "2026-01-15");
    expect(data.summary.totalTrades).toBe(0);
    expect(data.summary.closedTrades).toBe(0);
    expect(data.summary.winRate).toBe(0);
    expect(data.summary.netPnl).toBe(0);
    expect(data.pairs.rows).toEqual([]);
    expect(data.tags.rows).toEqual([]);
    expect(data.sessions.rows).toEqual([]);
  });

  it("computes summary stats from trades", () => {
    const trades = [
      makeRow({ pnl: 100 }),
      makeRow({ pnl: -50 }),
      makeRow({ pnl: 200 }),
    ];
    const data = buildReportData(trades, "2026-01-09", "2026-01-15");
    expect(data.summary.totalTrades).toBe(3);
    expect(data.summary.closedTrades).toBe(3);
    expect(data.summary.winners).toBe(2);
    expect(data.summary.losers).toBe(1);
    expect(data.summary.winRate).toBeCloseTo(2 / 3, 5);
    expect(data.summary.netPnl).toBe(250);
  });

  it("counts open trades separately", () => {
    const trades = [
      makeRow({ pnl: 100, closed_at: "2026-01-15T12:00:00Z" }),
      makeRow({ pnl: null, closed_at: null }),
    ];
    const data = buildReportData(trades, "2026-01-09", "2026-01-15");
    expect(data.summary.totalTrades).toBe(2);
    expect(data.summary.closedTrades).toBe(1);
    expect(data.summary.openTrades).toBe(1);
  });

  it("builds per-pair breakdown sorted by net PnL desc", () => {
    const trades = [
      makeRow({ pair: "EURUSD", pnl: 100 }),
      makeRow({ pair: "GBPUSD", pnl: -50 }),
      makeRow({ pair: "EURUSD", pnl: 50 }),
    ];
    const data = buildReportData(trades, "2026-01-09", "2026-01-15");
    expect(data.pairs.rows).toHaveLength(2);
    expect(data.pairs.rows[0]!.pair).toBe("EURUSD"); // +150
    expect(data.pairs.rows[1]!.pair).toBe("GBPUSD"); // -50
    expect(data.summary.bestPair).toBe("EURUSD");
    expect(data.summary.worstPair).toBe("GBPUSD");
  });

  it("builds per-tag breakdown", () => {
    const trades = [
      makeRow({ pnl: 100, tags: ["fomc", "breakout"] }),
      makeRow({ pnl: -50, tags: ["fomc"] }),
    ];
    const data = buildReportData(trades, "2026-01-09", "2026-01-15");
    // Both trades have "fomc" -> 1 row with 2 trades.
    // Only the first has "breakout" -> 1 row with 1 trade.
    expect(data.tags.rows).toHaveLength(2);
    const fomc = data.tags.rows.find((r) => r.tag === "fomc")!;
    expect(fomc.trades).toBe(2);
    expect(fomc.netPnl).toBe(50);
  });

  it("builds an equity curve from closed trades", () => {
    const trades = [
      makeRow({ pnl: 100, closed_at: "2026-01-15T12:00:00Z" }),
      makeRow({ pnl: 200, closed_at: "2026-01-16T12:00:00Z" }),
    ];
    const data = buildReportData(trades, "2026-01-09", "2026-01-15");
    expect(data.equityCurve.length).toBeGreaterThanOrEqual(2);
    // Last point should be 300 (100 + 200).
    const last = data.equityCurve[data.equityCurve.length - 1]!;
    expect(last.equity).toBe(300);
  });

  it("includes the window + generatedAt in the summary", () => {
    const data = buildReportData(
      [],
      "2026-01-09T00:00:00Z",
      "2026-01-15T23:59:59Z",
      "2026-01-16T10:00:00Z",
    );
    expect(data.summary.windowStart).toBe("2026-01-09T00:00:00Z");
    expect(data.summary.windowEnd).toBe("2026-01-15T23:59:59Z");
    expect(data.summary.generatedAt).toBe("2026-01-16T10:00:00Z");
  });
});

describe("formatSummaryLines", () => {
  it("formats all summary fields as readable lines", () => {
    const data = buildReportData(
      [makeRow({ pnl: 100 }), makeRow({ pnl: -50 })],
      "2026-01-09T00:00:00Z",
      "2026-01-15T23:59:59Z",
      "2026-01-16T10:00:00Z",
    );
    const lines = formatSummaryLines(data.summary);
    expect(lines.some((l) => l.includes("Window:"))).toBe(true);
    expect(lines.some((l) => l.includes("Generated:"))).toBe(true);
    expect(lines.some((l) => l.includes("Total trades: 2"))).toBe(true);
    expect(lines.some((l) => l.includes("Win rate:"))).toBe(true);
    expect(lines.some((l) => l.includes("Net PnL:"))).toBe(true);
    expect(lines.some((l) => l.includes("Best pair:"))).toBe(true);
  });

  it("shows — for best/worst pair when no trades", () => {
    const data = buildReportData([], "2026-01-09", "2026-01-15");
    const lines = formatSummaryLines(data.summary);
    expect(lines.some((l) => l.includes("Best pair: —"))).toBe(true);
    expect(lines.some((l) => l.includes("Worst pair: —"))).toBe(true);
  });
});
