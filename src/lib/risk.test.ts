/**
 * Unit tests for src/lib/risk.ts.
 *
 * Run: `npm run test` (or `bun run test`).
 *
 * Coverage:
 *  - pip size for default, JPY, XAUUSD
 *  - pip value per lot for USD-quote, JPY, USD-base, XAUUSD
 *  - position size (the headline formula)
 *  - risk-reward ratio
 *  - potential profit / loss
 *  - break-even win rate
 *  - pip distance helpers
 *  - warnings (wrong-side SL/TP, high risk, low RR)
 *  - invalid inputs return NaN
 */
import { describe, it, expect } from "vitest";
import {
  normalizePair,
  isJpyPair,
  isXauPair,
  pipSize,
  priceDiffInPips,
  signedPipDistance,
  pipValuePerLot,
  positionSize,
  riskRewardRatio,
  potentialLoss,
  potentialProfit,
  breakEvenWinRate,
  riskWarnings,
} from "@/lib/risk";

describe("normalizePair", () => {
  it("uppercases and strips slashes/space/dash", () => {
    expect(normalizePair("eur/usd")).toBe("EURUSD");
    expect(normalizePair(" gbpusd ")).toBe("GBPUSD");
    expect(normalizePair("usd-jpy")).toBe("USDJPY");
    expect(normalizePair("XAUUSD")).toBe("XAUUSD");
  });
});

describe("isJpyPair", () => {
  it("true for JPY quote pairs", () => {
    expect(isJpyPair("USDJPY")).toBe(true);
    expect(isJpyPair("EURJPY")).toBe(true);
    expect(isJpyPair("GBPJPY")).toBe(true);
  });
  it("false otherwise", () => {
    expect(isJpyPair("EURUSD")).toBe(false);
    expect(isJpyPair("XAUUSD")).toBe(false);
    expect(isJpyPair("USDCHF")).toBe(false);
  });
});

describe("isXauPair", () => {
  it("true only for XAUUSD", () => {
    expect(isXauPair("XAUUSD")).toBe(true);
    expect(isXauPair("xau/usd")).toBe(true);
    expect(isXauPair("EURUSD")).toBe(false);
    expect(isXauPair("USDJPY")).toBe(false);
  });
});

describe("pipSize", () => {
  it("0.0001 for default pairs", () => {
    expect(pipSize("EURUSD")).toBe(0.0001);
    expect(pipSize("GBPUSD")).toBe(0.0001);
    expect(pipSize("AUDUSD")).toBe(0.0001);
  });
  it("0.01 for JPY pairs", () => {
    expect(pipSize("USDJPY")).toBe(0.01);
    expect(pipSize("EURJPY")).toBe(0.01);
    expect(pipSize("GBPJPY")).toBe(0.01);
  });
  it("0.1 for XAUUSD", () => {
    expect(pipSize("XAUUSD")).toBe(0.1);
  });
});

describe("priceDiffInPips", () => {
  it("measures pips between two EURUSD prices", () => {
    expect(priceDiffInPips("EURUSD", 1.0850, 1.0820)).toBeCloseTo(30, 6);
    expect(priceDiffInPips("EURUSD", 1.0850, 1.0880)).toBeCloseTo(30, 6);
  });
  it("measures pips for USDJPY with 0.01 size", () => {
    expect(priceDiffInPips("USDJPY", 150.00, 149.70)).toBeCloseTo(30, 6);
    expect(priceDiffInPips("USDJPY", 150.00, 150.30)).toBeCloseTo(30, 6);
  });
  it("measures pips for XAUUSD with 0.1 size", () => {
    expect(priceDiffInPips("XAUUSD", 2000.0, 1995.0)).toBeCloseTo(50, 6);
  });
  it("returns NaN for invalid inputs", () => {
    expect(priceDiffInPips("EURUSD", NaN, 1.0820)).toBeNaN();
    expect(priceDiffInPips("EURUSD", 1.0850, Infinity)).toBeNaN();
  });
});

describe("signedPipDistance", () => {
  it("negative when target below entry", () => {
    expect(signedPipDistance("EURUSD", 1.0850, 1.0820)).toBeCloseTo(-30, 6);
  });
  it("positive when target above entry", () => {
    expect(signedPipDistance("EURUSD", 1.0850, 1.0880)).toBeCloseTo(30, 6);
  });
});

describe("pipValuePerLot", () => {
  it("$10 for USD-quote pairs (EURUSD, GBPUSD, AUDUSD)", () => {
    expect(pipValuePerLot("EURUSD")).toBe(10);
    expect(pipValuePerLot("GBPUSD")).toBe(10);
    expect(pipValuePerLot("AUDUSD")).toBe(10);
  });
  it("$10 for XAUUSD (100 oz * 0.1)", () => {
    expect(pipValuePerLot("XAUUSD")).toBe(10);
  });
  it("1000/price for USDJPY (JPY pairs)", () => {
    expect(pipValuePerLot("USDJPY", 150.00)).toBeCloseTo(6.6667, 3);
    expect(pipValuePerLot("USDJPY", 100.00)).toBeCloseTo(10, 6);
  });
  it("10/price for USD-base pairs (USDCHF)", () => {
    expect(pipValuePerLot("USDCHF", 0.90)).toBeCloseTo(11.1111, 3);
    expect(pipValuePerLot("USDCAD", 1.35)).toBeCloseTo(7.4074, 3);
  });
  it("returns NaN for JPY/USD-base pairs without a price", () => {
    expect(pipValuePerLot("USDJPY")).toBeNaN();
    expect(pipValuePerLot("USDCHF")).toBeNaN();
    expect(pipValuePerLot("EURJPY")).toBeNaN();
  });
});

describe("positionSize", () => {
  it("classic example: $10k, 1%, 30-pip SL, EURUSD", () => {
    // risk = $100, SL risk = 30 * $10 = $300, lots = 0.3333
    const lots = positionSize(10000, 1, 30, 10);
    expect(lots).toBeCloseTo(0.3333, 3);
  });
  it("JPY example: $5k, 0.5%, 25-pip SL, USDJPY@150", () => {
    // risk = $25, pipValue = 1000/150 = 6.6667
    // SL risk = 25 * 6.6667 = 166.67, lots = 25 / 166.67 = 0.15
    const pv = pipValuePerLot("USDJPY", 150);
    const lots = positionSize(5000, 0.5, 25, pv);
    expect(lots).toBeCloseTo(0.15, 2);
  });
  it("XAUUSD example: $10k, 1%, 50-pip SL (=$5 move)", () => {
    // pipValue = $10, risk = $100, SL risk = 50 * $10 = $500
    // lots = 100 / 500 = 0.20
    const pv = pipValuePerLot("XAUUSD");
    const lots = positionSize(10000, 1, 50, pv);
    expect(lots).toBeCloseTo(0.20, 3);
  });
  it("returns NaN for invalid inputs", () => {
    expect(positionSize(0, 1, 30, 10)).toBeNaN();
    expect(positionSize(10000, 0, 30, 10)).toBeNaN();
    expect(positionSize(10000, 1, 0, 10)).toBeNaN();
    expect(positionSize(10000, 1, 30, 0)).toBeNaN();
    expect(positionSize(NaN, 1, 30, 10)).toBeNaN();
    expect(positionSize(10000, -1, 30, 10)).toBeNaN();
  });
});

describe("riskRewardRatio", () => {
  it("2:1 reward:risk", () => {
    expect(riskRewardRatio(30, 60)).toBeCloseTo(2, 6);
  });
  it("1:1", () => {
    expect(riskRewardRatio(30, 30)).toBeCloseTo(1, 6);
  });
  it("below 1:1", () => {
    expect(riskRewardRatio(40, 30)).toBeCloseTo(0.75, 6);
  });
  it("NaN for invalid inputs", () => {
    expect(riskRewardRatio(0, 60)).toBeNaN();
    expect(riskRewardRatio(30, -5)).toBeNaN();
    expect(riskRewardRatio(NaN, 60)).toBeNaN();
  });
});

describe("potentialLoss / potentialProfit", () => {
  it("loss for 0.33 lots, 30 pips, $10/pip", () => {
    expect(potentialLoss(0.3333, 30, 10)).toBeCloseTo(100, 1);
  });
  it("profit for 0.33 lots, 60 pips, $10/pip (RR 2)", () => {
    expect(potentialProfit(0.3333, 60, 10)).toBeCloseTo(200, 1);
  });
  it("NaN for invalid inputs", () => {
    expect(potentialLoss(-1, 30, 10)).toBeNaN();
    expect(potentialProfit(0.33, NaN, 10)).toBeNaN();
  });
});

describe("breakEvenWinRate", () => {
  it("RR=2 -> 1/3", () => {
    expect(breakEvenWinRate(2)).toBeCloseTo(0.3333, 4);
  });
  it("RR=1 -> 0.5", () => {
    expect(breakEvenWinRate(1)).toBeCloseTo(0.5, 6);
  });
  it("RR=3 -> 0.25", () => {
    expect(breakEvenWinRate(3)).toBeCloseTo(0.25, 6);
  });
  it("RR=0 -> 1 (must win every trade)", () => {
    expect(breakEvenWinRate(0)).toBe(1);
  });
  it("NaN for invalid", () => {
    expect(breakEvenWinRate(-1)).toBeNaN();
    expect(breakEvenWinRate(NaN)).toBeNaN();
  });
});

describe("riskWarnings", () => {
  it("flags SL on wrong side for a BUY", () => {
    const w = riskWarnings({
      pair: "EURUSD", direction: "buy",
      entry: 1.0850, stopLoss: 1.0900,
    });
    expect(w.some((x) => x.level === "error" && /below entry/.test(x.message))).toBe(true);
  });
  it("flags SL on wrong side for a SELL", () => {
    const w = riskWarnings({
      pair: "EURUSD", direction: "sell",
      entry: 1.0850, stopLoss: 1.0800,
    });
    expect(w.some((x) => x.level === "error" && /above entry/.test(x.message))).toBe(true);
  });
  it("flags TP on wrong side for a BUY", () => {
    const w = riskWarnings({
      pair: "EURUSD", direction: "buy",
      entry: 1.0850, stopLoss: 1.0820, takeProfit: 1.0800,
    });
    expect(w.some((x) => x.level === "error" && /take profit must be above/.test(x.message))).toBe(true);
  });
  it("warns when risk > 2%", () => {
    const w = riskWarnings({
      pair: "EURUSD", direction: "buy",
      entry: 1.0850, stopLoss: 1.0820,
      riskPct: 5,
    });
    expect(w.some((x) => x.level === "warning" && /5.00% is high/.test(x.message))).toBe(true);
  });
  it("warns when RR < 1", () => {
    const w = riskWarnings({
      pair: "EURUSD", direction: "buy",
      entry: 1.0850, stopLoss: 1.0820, takeProfit: 1.0870,
      rr: 0.67,
    });
    expect(w.some((x) => x.level === "warning" && /below 1:1/.test(x.message))).toBe(true);
  });
  it("returns no errors for a clean BUY setup", () => {
    const w = riskWarnings({
      pair: "EURUSD", direction: "buy",
      entry: 1.0850, stopLoss: 1.0820, takeProfit: 1.0910,
      riskPct: 1, rr: 2,
    });
    expect(w.filter((x) => x.level === "error")).toHaveLength(0);
  });
  it("returns errors when SL equals entry", () => {
    const w = riskWarnings({
      pair: "EURUSD", direction: "buy",
      entry: 1.0850, stopLoss: 1.0850,
    });
    expect(w.some((x) => x.level === "error" && /cannot equal entry/.test(x.message))).toBe(true);
  });
  it("flags invalid numbers", () => {
    const w = riskWarnings({
      pair: "EURUSD", direction: "buy",
      entry: NaN, stopLoss: 1.0820,
    });
    expect(w.some((x) => x.level === "error" && /valid numbers/.test(x.message))).toBe(true);
  });
});
