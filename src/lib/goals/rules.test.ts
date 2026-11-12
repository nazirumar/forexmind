/**
 * Tests for the Trading Goals rule engine (Phase 20).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateGoals,
  violationSummary,
  type GoalViolation,
} from "@/lib/goals/rules";
import { DEFAULT_GOALS, type GoalsRow } from "@/lib/goals/schema";
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

describe("evaluateGoals", () => {
  it("returns no violations when goals are all null (DEFAULT_GOALS)", () => {
    const trades = [makeRow({ pnl: 100 }), makeRow({ pnl: -50 })];
    expect(evaluateGoals(trades, DEFAULT_GOALS)).toEqual([]);
  });

  it("returns no violations when no trades", () => {
    const goals: GoalsRow = { ...DEFAULT_GOALS, max_trades_per_day: 3 };
    expect(evaluateGoals([], goals)).toEqual([]);
  });

  // --- Rule 1: max trades per day ---
  it("flags days exceeding max_trades_per_day", () => {
    const trades = [
      makeRow({ id: "1", opened_at: "2026-01-15T08:00:00Z", pnl: 10 }),
      makeRow({ id: "2", opened_at: "2026-01-15T10:00:00Z", pnl: 10 }),
      makeRow({ id: "3", opened_at: "2026-01-15T12:00:00Z", pnl: 10 }),
      makeRow({ id: "4", opened_at: "2026-01-15T14:00:00Z", pnl: 10 }),
    ];
    const goals: GoalsRow = { ...DEFAULT_GOALS, max_trades_per_day: 3 };
    const v = evaluateGoals(trades, goals);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("max_trades_per_day");
    expect(v[0]!.severity).toBe("high");
    expect(v[0]!.actual).toBe(4);
    expect(v[0]!.threshold).toBe(3);
    expect(v[0]!.at).toBe("2026-01-15");
  });

  it("does not flag a day at exactly the limit", () => {
    const trades = [
      makeRow({ opened_at: "2026-01-15T08:00:00Z", pnl: 10 }),
      makeRow({ opened_at: "2026-01-15T10:00:00Z", pnl: 10 }),
      makeRow({ opened_at: "2026-01-15T12:00:00Z", pnl: 10 }),
    ];
    const goals: GoalsRow = { ...DEFAULT_GOALS, max_trades_per_day: 3 };
    expect(evaluateGoals(trades, goals)).toEqual([]);
  });

  // --- Rule 2: max daily loss % ---
  it("flags days where summed loss exceeds max_daily_loss_pct", () => {
    // Balance 10,000, two losing trades totalling -400 = 4% > 3%.
    const trades = [
      makeRow({ opened_at: "2026-01-15T08:00:00Z", pnl: -250 }),
      makeRow({ opened_at: "2026-01-15T10:00:00Z", pnl: -150 }),
    ];
    const goals: GoalsRow = { ...DEFAULT_GOALS, max_daily_loss_pct: 3 };
    const v = evaluateGoals(trades, goals, 10_000);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("max_daily_loss_pct");
    expect(v[0]!.severity).toBe("high");
    expect(v[0]!.actual).toBe(4);
    expect(v[0]!.threshold).toBe(3);
  });

  it("does not flag a losing day within the limit", () => {
    const trades = [makeRow({ opened_at: "2026-01-15T08:00:00Z", pnl: -200 })];
    const goals: GoalsRow = { ...DEFAULT_GOALS, max_daily_loss_pct: 3 };
    expect(evaluateGoals(trades, goals, 10_000)).toEqual([]);
  });

  it("does not flag a winning day even if large", () => {
    const trades = [makeRow({ opened_at: "2026-01-15T08:00:00Z", pnl: 5000 })];
    const goals: GoalsRow = { ...DEFAULT_GOALS, max_daily_loss_pct: 3 };
    expect(evaluateGoals(trades, goals, 10_000)).toEqual([]);
  });

  // --- Rule 3: min RR target ---
  it("flags trades with RR below min_rr_target", () => {
    // entry 1.085, SL 1.080, TP 1.090 -> RR = 5pips/5pips = 1.0
    const trades = [
      makeRow({ entry_price: 1.085, stop_loss: 1.08, take_profit: 1.09, pnl: 50 }),
    ];
    const goals: GoalsRow = { ...DEFAULT_GOALS, min_rr_target: 1.5 };
    const v = evaluateGoals(trades, goals);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("min_rr_target");
    expect(v[0]!.severity).toBe("medium");
    expect(v[0]!.actual).toBe(1);
  });

  it("does not flag trades with RR at or above target", () => {
    const trades = [
      makeRow({ entry_price: 1.085, stop_loss: 1.08, take_profit: 1.095, pnl: 50 }),
    ];
    const goals: GoalsRow = { ...DEFAULT_GOALS, min_rr_target: 1.5 };
    // RR = 10 pips / 5 pips = 2.0 >= 1.5
    expect(evaluateGoals(trades, goals)).toEqual([]);
  });

  it("skips trades with no TP for the RR rule", () => {
    const trades = [makeRow({ take_profit: null, pnl: 50 })];
    const goals: GoalsRow = { ...DEFAULT_GOALS, min_rr_target: 1.5 };
    expect(evaluateGoals(trades, goals)).toEqual([]);
  });

  // --- Rule 4: max consecutive losses ---
  it("flags runs of consecutive losses exceeding the limit", () => {
    const trades = [
      makeRow({ id: "1", opened_at: "2026-01-15T08:00:00Z", pnl: -10 }),
      makeRow({ id: "2", opened_at: "2026-01-15T10:00:00Z", pnl: -10 }),
      makeRow({ id: "3", opened_at: "2026-01-15T12:00:00Z", pnl: -10 }),
      makeRow({ id: "4", opened_at: "2026-01-15T14:00:00Z", pnl: -10 }),
    ];
    const goals: GoalsRow = { ...DEFAULT_GOALS, max_consecutive_losses: 3 };
    const v = evaluateGoals(trades, goals);
    // One violation per trade that pushes the run past the limit:
    // trade 4 pushes run from 3 to 4 (>3). Trade 3 is at exactly 3, not past.
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("max_consecutive_losses");
    expect(v[0]!.severity).toBe("high");
    expect(v[0]!.actual).toBe(4);
  });

  it("resets the consecutive-loss counter on a winner", () => {
    const trades = [
      makeRow({ opened_at: "2026-01-15T08:00:00Z", pnl: -10 }),
      makeRow({ opened_at: "2026-01-15T10:00:00Z", pnl: -10 }),
      makeRow({ opened_at: "2026-01-15T12:00:00Z", pnl: 50 }), // winner resets
      makeRow({ opened_at: "2026-01-15T14:00:00Z", pnl: -10 }),
    ];
    const goals: GoalsRow = { ...DEFAULT_GOALS, max_consecutive_losses: 2 };
    expect(evaluateGoals(trades, goals)).toEqual([]);
  });

  // --- Rule 5: require followed plan ---
  it("flags trades that didn't follow the plan when required", () => {
    const trades = [
      makeRow({ id: "1", opened_at: "2026-01-15T08:00:00Z", pnl: 10, followed_plan: true }),
      makeRow({ id: "2", opened_at: "2026-01-16T08:00:00Z", pnl: 10, followed_plan: false }),
    ];
    const goals: GoalsRow = { ...DEFAULT_GOALS, require_followed_plan: true };
    const v = evaluateGoals(trades, goals);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("require_followed_plan");
    expect(v[0]!.severity).toBe("medium");
  });

  it("does not flag plan-broken trades when the rule is off", () => {
    const trades = [makeRow({ followed_plan: false, pnl: 10 })];
    const goals: GoalsRow = { ...DEFAULT_GOALS, require_followed_plan: false };
    expect(evaluateGoals(trades, goals)).toEqual([]);
  });

  // --- Combined ---
  it("combines violations from multiple rules, sorted by date", () => {
    const trades = [
      makeRow({ id: "1", opened_at: "2026-01-14T08:00:00Z", pnl: -10, followed_plan: false }),
      makeRow({ id: "2", opened_at: "2026-01-15T08:00:00Z", pnl: -10 }),
      makeRow({ id: "3", opened_at: "2026-01-15T10:00:00Z", pnl: -10 }),
      makeRow({ id: "4", opened_at: "2026-01-15T12:00:00Z", pnl: -10 }),
    ];
    const goals: GoalsRow = {
      ...DEFAULT_GOALS,
      max_consecutive_losses: 2,
      require_followed_plan: true,
    };
    const v = evaluateGoals(trades, goals);
    // trade 1 -> plan violation; trades 3 and 4 push the loss run past 2.
    expect(v).toHaveLength(3);
    expect(v[0]!.rule).toBe("require_followed_plan");
    expect(v[0]!.at).toBe("2026-01-14T08:00:00Z");
    expect(v[1]!.rule).toBe("max_consecutive_losses");
    expect(v[1]!.at).toBe("2026-01-15T10:00:00Z");
    expect(v[2]!.rule).toBe("max_consecutive_losses");
    expect(v[2]!.at).toBe("2026-01-15T12:00:00Z");
  });
});

describe("violationSummary", () => {
  it("counts by severity", () => {
    const vs: GoalViolation[] = [
      { rule: "max_trades_per_day", message: "x", severity: "high", at: "2026-01-01", actual: 5, threshold: 3 },
      { rule: "min_rr_target", message: "y", severity: "medium", at: "2026-01-02", actual: 1, threshold: 1.5 },
      { rule: "require_followed_plan", message: "z", severity: "medium", at: "2026-01-03", actual: 0, threshold: 1 },
    ];
    expect(violationSummary(vs)).toEqual({
      high: 1,
      medium: 2,
      low: 0,
      total: 3,
    });
  });

  it("returns zeros for empty input", () => {
    expect(violationSummary([])).toEqual({ high: 0, medium: 0, low: 0, total: 0 });
  });
});
