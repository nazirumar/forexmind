/**
 * Tests for the Trade Plan Coach rule engine.
 *
 * The engine is pure: given (input, profile, config), it deterministically
 * returns a list of RuleResult + verdict. We test:
 *
 *  - Each rule individually (checkRiskPct, checkRiskReward, etc.).
 *  - The full evaluatePlan pipeline including fallbacks.
 *  - The verdict derivation matrix.
 *
 * Mirrors the style of risk.test.ts and analytics.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  checkPositionSize,
  checkRiskPct,
  checkRiskReward,
  checkStopLossPlacement,
  DEFAULT_PLAN_RULES,
  deriveVerdict,
  evaluatePlan,
  evaluateRules,
  resolvePlan,
  DEFAULT_ACCOUNT_BALANCE,
  DEFAULT_RISK_PCT,
  type PlanRulesConfig,
} from "@/lib/plan/rules";
import type { PlanInput, RuleResult } from "@/lib/plan/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    pair: "EURUSD",
    direction: "buy",
    entry_price: 1.085,
    stop_loss: 1.082,
    take_profit: 1.091,
    account_balance: 10_000,
    risk_pct: 1,
    lot_size: null,
    notes: "",
    ...overrides,
  } as PlanInput;
}

// ---------------------------------------------------------------------------
// resolvePlan
// ---------------------------------------------------------------------------

describe("resolvePlan", () => {
  it("uses provided values when present", () => {
    const input = makeInput({ account_balance: 5000, risk_pct: 0.5 });
    const plan = resolvePlan(input, {});
    expect(plan.account_balance).toBe(5000);
    expect(plan.risk_pct).toBe(0.5);
    expect(plan.balance_inferred).toBe(false);
    expect(plan.risk_inferred).toBe(false);
  });

  it("falls back to profile.default_balance when input missing", () => {
    const input = makeInput({ account_balance: null });
    const plan = resolvePlan(input, { default_balance: 7500 });
    expect(plan.account_balance).toBe(7500);
    expect(plan.balance_inferred).toBe(true);
  });

  it("falls back to DEFAULT_ACCOUNT_BALANCE when both missing", () => {
    const input = makeInput({ account_balance: null });
    const plan = resolvePlan(input, {});
    expect(plan.account_balance).toBe(DEFAULT_ACCOUNT_BALANCE);
    expect(plan.balance_inferred).toBe(true);
  });

  it("falls back to profile.default_risk_pct when input missing", () => {
    const input = makeInput({ risk_pct: null });
    const plan = resolvePlan(input, { default_risk_pct: 1.5 });
    expect(plan.risk_pct).toBe(1.5);
    expect(plan.risk_inferred).toBe(true);
  });

  it("falls back to DEFAULT_RISK_PCT when both missing", () => {
    const input = makeInput({ risk_pct: null });
    const plan = resolvePlan(input, {});
    expect(plan.risk_pct).toBe(DEFAULT_RISK_PCT);
    expect(plan.risk_inferred).toBe(true);
  });

  it("ignores non-positive profile balance (treats as missing)", () => {
    const input = makeInput({ account_balance: null });
    const plan = resolvePlan(input, { default_balance: 0 });
    expect(plan.account_balance).toBe(DEFAULT_ACCOUNT_BALANCE);
  });

  it("ignores non-positive profile risk_pct (treats as missing)", () => {
    const input = makeInput({ risk_pct: null });
    const plan = resolvePlan(input, { default_risk_pct: 0 });
    expect(plan.risk_pct).toBe(DEFAULT_RISK_PCT);
  });
});

// ---------------------------------------------------------------------------
// checkRiskPct
// ---------------------------------------------------------------------------

describe("checkRiskPct", () => {
  it("passes when risk is below max", () => {
    const r = checkRiskPct(1.0, 2.0);
    expect(r.passed).toBe(true);
    expect(r.severity).toBe("info");
    expect(r.detail).toContain("1.00");
    expect(r.detail).toContain("2.00");
  });

  it("passes when risk equals max", () => {
    const r = checkRiskPct(2.0, 2.0);
    expect(r.passed).toBe(true);
  });

  it("fails (high) when risk is above max", () => {
    const r = checkRiskPct(3.0, 2.0);
    expect(r.passed).toBe(false);
    expect(r.severity).toBe("high");
  });

  it("fails (high) when risk is NaN", () => {
    const r = checkRiskPct(NaN, 2.0);
    expect(r.passed).toBe(false);
    expect(r.severity).toBe("high");
  });

  it("fails (high) when risk is negative", () => {
    const r = checkRiskPct(-1, 2.0);
    expect(r.passed).toBe(false);
    expect(r.severity).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// checkRiskReward
// ---------------------------------------------------------------------------

describe("checkRiskReward", () => {
  it("skips (passed=true, info) when no TP", () => {
    const r = checkRiskReward("EURUSD", "buy", 1.085, 1.082, null, 1.5);
    expect(r.passed).toBe(true);
    expect(r.severity).toBe("info");
    expect(r.detail).toContain("No take-profit");
  });

  it("passes when RR >= min", () => {
    // entry 1.085, SL 1.082 (30 pips risk), TP 1.091 (60 pips reward) -> RR 2.0
    const r = checkRiskReward("EURUSD", "buy", 1.085, 1.082, 1.091, 1.5);
    expect(r.passed).toBe(true);
    expect(r.detail).toContain("2.00");
  });

  it("fails (high) when RR < min", () => {
    // entry 1.085, SL 1.082 (30 pips risk), TP 1.088 (30 pips reward) -> RR 1.0
    const r = checkRiskReward("EURUSD", "buy", 1.085, 1.082, 1.088, 1.5);
    expect(r.passed).toBe(false);
    expect(r.severity).toBe("high");
  });

  it("passes for a SELL setup with TP below entry", () => {
    // SELL entry 1.085, SL 1.088 (30 pips risk), TP 1.076 (90 pips reward) -> RR 3.0
    const r = checkRiskReward("EURUSD", "sell", 1.085, 1.088, 1.076, 1.5);
    expect(r.passed).toBe(true);
  });

  it("handles JPY pairs (pip size 0.01)", () => {
    // USDJPY buy entry 150.00, SL 149.70 (30 pips), TP 150.60 (60 pips) -> RR 2.0
    const r = checkRiskReward("USDJPY", "buy", 150.0, 149.7, 150.6, 1.5);
    expect(r.passed).toBe(true);
    expect(r.detail).toContain("2.00");
  });
});

// ---------------------------------------------------------------------------
// checkStopLossPlacement
// ---------------------------------------------------------------------------

describe("checkStopLossPlacement", () => {
  it("passes for BUY with SL below entry", () => {
    const r = checkStopLossPlacement("buy", 1.085, 1.082);
    expect(r.passed).toBe(true);
  });

  it("fails for BUY with SL above entry", () => {
    const r = checkStopLossPlacement("buy", 1.085, 1.088);
    expect(r.passed).toBe(false);
    expect(r.severity).toBe("high");
  });

  it("passes for SELL with SL above entry", () => {
    const r = checkStopLossPlacement("sell", 1.085, 1.088);
    expect(r.passed).toBe(true);
  });

  it("fails for SELL with SL below entry", () => {
    const r = checkStopLossPlacement("sell", 1.085, 1.082);
    expect(r.passed).toBe(false);
    expect(r.severity).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// checkPositionSize
// ---------------------------------------------------------------------------

describe("checkPositionSize", () => {
  it("returns info (passed=true) with a suggested size when lot_size is null", () => {
    const r = checkPositionSize("EURUSD", 1.085, 1.082, 10_000, 1, null, 2.0);
    expect(r.passed).toBe(true);
    expect(r.severity).toBe("info");
    expect(r.detail).toContain("Suggested size");
  });

  it("passes when implied risk is within max", () => {
    // EURUSD: lot 0.33, SL 30 pips, pipVal $10 -> risk = 0.33*30*10 = $99 on $10,000 = 0.99%
    const r = checkPositionSize("EURUSD", 1.085, 1.082, 10_000, 1, 0.33, 2.0);
    expect(r.passed).toBe(true);
    expect(r.detail).toContain("0.99");
  });

  it("fails (medium) when implied risk is above max but <= 2x max", () => {
    // lot 0.20, balance $2,000 -> 0.20*30*10 = $60 on $2,000 = 3.00% (between max 2% and 2x max 4%)
    const r = checkPositionSize("EURUSD", 1.085, 1.082, 2_000, 1, 0.2, 2.0);
    expect(r.passed).toBe(false);
    expect(r.severity).toBe("medium");
  });

  it("fails (high) when implied risk > 2x max", () => {
    // lot 1.0, balance $1,000 -> 1*30*10 = $300 on $1,000 = 30% which is 15x max
    const r = checkPositionSize("EURUSD", 1.085, 1.082, 1_000, 1, 1.0, 2.0);
    expect(r.passed).toBe(false);
    expect(r.severity).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// evaluateRules + deriveVerdict
// ---------------------------------------------------------------------------

describe("evaluateRules", () => {
  it("returns 4 rules in a stable order", () => {
    const input = makeInput();
    const plan = resolvePlan(input, {});
    const results = evaluateRules(plan);
    expect(results).toHaveLength(4);
    expect(results[0].rule).toBe("Risk per trade");
    expect(results[1].rule).toBe("Risk-reward ratio");
    expect(results[2].rule).toBe("Stop-loss placement");
    expect(results[3].rule).toBe("Position size");
  });

  it("all pass for a clean EURUSD setup", () => {
    const input = makeInput({
      entry_price: 1.085,
      stop_loss: 1.082,
      take_profit: 1.091,
      risk_pct: 1,
      account_balance: 10_000,
    });
    const plan = resolvePlan(input, {});
    const results = evaluateRules(plan);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

describe("deriveVerdict", () => {
  function makeResults(
    flags: Array<{ passed: boolean; severity: "high" | "medium" | "info" }>,
  ): RuleResult[] {
    return flags.map((f, i) => ({
      rule: `Rule ${i + 1}`,
      passed: f.passed,
      detail: "test",
      severity: f.severity,
    }));
  }

  it("returns 'pass' when all rules pass", () => {
    const r = makeResults([
      { passed: true, severity: "info" },
      { passed: true, severity: "info" },
    ]);
    expect(deriveVerdict(r)).toBe("pass");
  });

  it("returns 'fail' when any high-severity rule fails", () => {
    const r = makeResults([
      { passed: true, severity: "info" },
      { passed: false, severity: "high" },
      { passed: true, severity: "info" },
    ]);
    expect(deriveVerdict(r)).toBe("fail");
  });

  it("returns 'review' when only medium-severity rule fails", () => {
    const r = makeResults([
      { passed: true, severity: "info" },
      { passed: false, severity: "medium" },
    ]);
    expect(deriveVerdict(r)).toBe("review");
  });

  it("returns 'fail' (not 'review') when both high and medium fail", () => {
    const r = makeResults([
      { passed: false, severity: "high" },
      { passed: false, severity: "medium" },
    ]);
    expect(deriveVerdict(r)).toBe("fail");
  });

  it("returns 'pass' for empty result list (no rules to fail)", () => {
    expect(deriveVerdict([])).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// evaluatePlan (end-to-end)
// ---------------------------------------------------------------------------

describe("evaluatePlan", () => {
  it("returns pass verdict for a clean setup with profile defaults", () => {
    const input = makeInput();
    const { verdict, rules, plan } = evaluatePlan(input, {
      default_balance: 10_000,
      default_risk_pct: 1,
    });
    expect(verdict).toBe("pass");
    expect(rules).toHaveLength(4);
    expect(plan.balance_inferred).toBe(false);
  });

  it("returns fail verdict when risk_pct exceeds max", () => {
    const input = makeInput({ risk_pct: 5 });
    const { verdict, rules } = evaluatePlan(input, {});
    expect(verdict).toBe("fail");
    expect(rules[0].passed).toBe(false);
    expect(rules[0].severity).toBe("high");
  });

  it("returns fail verdict when RR is below min", () => {
    // RR 1.0 < 1.5
    const input = makeInput({
      entry_price: 1.085,
      stop_loss: 1.082,
      take_profit: 1.088,
    });
    const { verdict, rules } = evaluatePlan(input, {});
    expect(verdict).toBe("fail");
    expect(rules[1].passed).toBe(false);
    expect(rules[1].severity).toBe("high");
  });

  it("returns review verdict when only position size medium-fails", () => {
    // lot 0.20 on a small $2,000 balance -> implied risk 3.0% (medium fail, between 2% and 2x 4%)
    const input = makeInput({
      account_balance: 2_000,
      lot_size: 0.2,
    });
    const { verdict, rules } = evaluatePlan(input, {});
    expect(verdict).toBe("review");
    expect(rules[3].passed).toBe(false);
    expect(rules[3].severity).toBe("medium");
  });

  it("respects a custom config (lower max risk -> fail)", () => {
    const input = makeInput({ risk_pct: 1 });
    const strictConfig: PlanRulesConfig = { maxRiskPct: 0.5, minRR: 1.5 };
    const { verdict } = evaluatePlan(input, {}, strictConfig);
    expect(verdict).toBe("fail");
  });

  it("respects a custom config (higher min RR -> fail)", () => {
    const input = makeInput();
    const strictConfig: PlanRulesConfig = { maxRiskPct: 2, minRR: 3.0 };
    const { verdict, rules } = evaluatePlan(input, {}, strictConfig);
    expect(verdict).toBe("fail");
    expect(rules[1].passed).toBe(false);
  });

  it("uses DEFAULT_PLAN_RULES when no config given", () => {
    const input = makeInput({ risk_pct: 2 }); // exactly at default max
    const { verdict } = evaluatePlan(input, {});
    expect(verdict).toBe("pass");
    expect(DEFAULT_PLAN_RULES.maxRiskPct).toBe(2.0);
    expect(DEFAULT_PLAN_RULES.minRR).toBe(1.5);
  });

  it("handles SELL setups correctly", () => {
    const input = makeInput({
      direction: "sell",
      entry_price: 1.085,
      stop_loss: 1.088,
      take_profit: 1.076,
    });
    const { verdict, rules } = evaluatePlan(input, {});
    expect(verdict).toBe("pass");
    expect(rules[2].passed).toBe(true); // SL placement
  });

  it("handles missing TP gracefully (RR rule skipped)", () => {
    const input = makeInput({ take_profit: null });
    const { verdict, rules } = evaluatePlan(input, {});
    expect(verdict).toBe("pass");
    expect(rules[1].passed).toBe(true);
    expect(rules[1].severity).toBe("info");
  });
});
