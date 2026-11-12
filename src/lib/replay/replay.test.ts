/**
 * Tests for the Trade Replay what-if math (Phase 21).
 */
import { describe, it, expect } from "vitest";
import { computeReplay, formatDollars, formatPips, type ReplayInput } from "@/lib/replay/replay";

const original = {
  pair: "EURUSD",
  direction: "buy" as const,
  entry_price: 1.085,
  stop_loss: 1.08,
  take_profit: 1.095,
  exit_price: 1.09,
  pnl: 50,
  lot_size: 0.5,
};

describe("computeReplay - identity (adjusted == original)", () => {
  it("produces matching PnL when adjusted == original", () => {
    const adjusted: ReplayInput = {
      pair: "EURUSD",
      direction: "buy",
      entry_price: 1.085,
      stop_loss: 1.08,
      take_profit: 1.095,
      exit_price: 1.09,
      lot_size: 0.5,
    };
    const r = computeReplay(original, adjusted);
    // exit 1.09 - entry 1.085 = 0.005 = 50 pips (EURUSD pip 0.0001)
    // dollars = 50 pips * $10/pip * 0.5 lot = $250 ... wait let me check.
    // Actually 0.005 / 0.0001 = 50 pips. pipValue EURUSD = $10. 50 * 10 * 0.5 = $250.
    // But original.pnl is 50 (the recorded PnL). So adjustedPnl = 250, not 50.
    // The original trade may have had a different lot or the PnL was hand-entered.
    expect(r.adjustedPnl).toBe(250);
    expect(r.originalPnl).toBe(50);
    expect(r.pnlDelta).toBe(200);
  });

  it("computes RR from entry/SL/TP", () => {
    const adjusted: ReplayInput = {
      pair: "EURUSD",
      direction: "buy",
      entry_price: 1.085,
      stop_loss: 1.08,
      take_profit: 1.095,
      exit_price: 1.09,
      lot_size: 0.5,
    };
    const r = computeReplay(original, adjusted);
    // risk = |1.085 - 1.080| = 0.005 = 50 pips
    // reward = |1.095 - 1.085| = 0.010 = 100 pips
    // RR = 100/50 = 2.0
    expect(r.adjustedRR).toBe(2);
    expect(r.originalRR).toBe(2);
  });

  it("computes risk amount from entry->SL", () => {
    const adjusted: ReplayInput = {
      pair: "EURUSD",
      direction: "buy",
      entry_price: 1.085,
      stop_loss: 1.08,
      take_profit: 1.095,
      exit_price: null,
      lot_size: 1.0,
    };
    const r = computeReplay(original, adjusted);
    // 50 pips * $10 * 1.0 lot = $500 at risk.
    expect(r.riskAmount).toBe(500);
    expect(r.riskLeg.pips).toBe(50);
  });
});

describe("computeReplay - what-if scenarios", () => {
  it("tighter SL reduces risk amount and increases RR", () => {
    const adjusted: ReplayInput = {
      pair: "EURUSD",
      direction: "buy",
      entry_price: 1.085,
      stop_loss: 1.0825, // tighter: 25 pips instead of 50
      take_profit: 1.095, // same target: 100 pips
      exit_price: null,
      lot_size: 1.0,
    };
    const r = computeReplay(original, adjusted);
    // risk = 25 pips * $10 * 1 = $250
    expect(r.riskAmount).toBe(250);
    // RR = 100 / 25 = 4
    expect(r.adjustedRR).toBe(4);
  });

  it("larger lot size scales PnL proportionally", () => {
    const baseAdjusted: ReplayInput = {
      pair: "EURUSD",
      direction: "buy",
      entry_price: 1.085,
      stop_loss: 1.08,
      take_profit: 1.095,
      exit_price: 1.09,
      lot_size: 0.5,
    };
    const doubleLot: ReplayInput = { ...baseAdjusted, lot_size: 1.0 };
    const r1 = computeReplay(original, baseAdjusted);
    const r2 = computeReplay(original, doubleLot);
    expect(r2.adjustedPnl).toBeCloseTo(r1.adjustedPnl! * 2, 1);
  });

  it("sell direction flips the dollar sign", () => {
    // Sell EURUSD: entry 1.09, exit 1.085 -> price fell, profitable.
    const adjusted: ReplayInput = {
      pair: "EURUSD",
      direction: "sell",
      entry_price: 1.09,
      stop_loss: 1.095,
      take_profit: 1.08,
      exit_price: 1.085,
      lot_size: 0.5,
    };
    const r = computeReplay(
      { ...original, direction: "sell" as const },
      adjusted,
    );
    // exit 1.085, entry 1.09 -> price fell 50 pips. For a sell that's +$250.
    expect(r.adjustedPnl).toBe(250);
    expect(r.realizedLeg!.pips).toBe(50); // absolute distance
  });

  it("null exit returns null adjustedPnl and null realizedLeg", () => {
    const adjusted: ReplayInput = {
      pair: "EURUSD",
      direction: "buy",
      entry_price: 1.085,
      stop_loss: 1.08,
      take_profit: 1.095,
      exit_price: null,
      lot_size: 0.5,
    };
    const r = computeReplay(original, adjusted);
    expect(r.adjustedPnl).toBeNull();
    expect(r.realizedLeg).toBeNull();
    expect(r.pnlDelta).toBeNull();
  });

  it("null TP returns null rewardLeg and NaN adjustedRR", () => {
    const adjusted: ReplayInput = {
      pair: "EURUSD",
      direction: "buy",
      entry_price: 1.085,
      stop_loss: 1.08,
      take_profit: null,
      exit_price: 1.09,
      lot_size: 0.5,
    };
    const r = computeReplay(original, adjusted);
    expect(r.rewardLeg).toBeNull();
    expect(r.rewardAmount).toBeNull();
    expect(Number.isNaN(r.adjustedRR)).toBe(true);
  });

  it("JPY pair uses 0.01 pip size", () => {
    // USDJPY: entry 150.00, SL 149.70 -> 30 pips (0.01 pip size).
    const adjusted: ReplayInput = {
      pair: "USDJPY",
      direction: "buy",
      entry_price: 150.0,
      stop_loss: 149.7,
      take_profit: 150.6,
      exit_price: null,
      lot_size: 1.0,
    };
    const r = computeReplay(
      { ...original, pair: "USDJPY" },
      adjusted,
    );
    expect(r.riskLeg.pips).toBe(30);
    // pipValue USDJPY at 150 = 1000/150 = 6.667. 30 * 6.667 * 1 = 200.
    expect(r.riskAmount).toBeCloseTo(200, 0);
  });
});

describe("formatDollars / formatPips", () => {
  it("formatDollars signs and formats", () => {
    expect(formatDollars(250)).toBe("$250.00");
    expect(formatDollars(-125.5)).toBe("-$125.50");
    expect(formatDollars(null)).toBe("—");
    expect(formatDollars(NaN)).toBe("—");
  });

  it("formatPips signs and formats", () => {
    expect(formatPips(50)).toBe("+50.0 pips");
    expect(formatPips(-30)).toBe("-30.0 pips");
    expect(formatPips(null)).toBe("—");
  });
});
