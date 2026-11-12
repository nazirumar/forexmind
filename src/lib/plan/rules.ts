/**
 * Trade Plan Coach - DETERMINISTIC rule engine.
 *
 * Pure functions: input is the validated plan + the user's profile
 * defaults; output is a list of RuleResult + the derived verdict.
 *
 * No DB access, no AI calls. Trivially testable.
 *
 * Rules evaluated (all DETERMINISTIC):
 *
 *  1. Risk per trade (% of balance)
 *     - PASS if riskPct <= profile.maxRiskPct (default 2.0)
 *     - FAIL (high) if above.
 *
 *  2. Risk-reward ratio
 *     - SKIP (info, passed=true) if no TP provided.
 *     - PASS if RR >= profile.minRR (default 1.5).
 *     - FAIL (high) if below.
 *
 *  3. Stop-loss placement
 *     - PASS (sanity) if SL is on the correct side of entry for the
 *       direction. This is also enforced by the zod schema, so this
 *       rule should always pass for a validated input. We include
 *       it anyway as a defense-in-depth check.
 *
 *  4. Position size sanity (only if lot_size provided)
 *     - Compute implied risk % from lot_size + SL distance.
 *     - PASS if implied risk <= maxRiskPct.
 *     - FAIL (medium) if above (medium because the user might still
 *       be willing to take a slightly larger risk; high would be
 *       reserved for >2x the max).
 *
 * Verdict derivation:
 *  - "fail":    any high-severity rule failed.
 *  - "review":  no high failures, but a rule could not be evaluated
 *              (missing data -> passed=true, severity="info", detail
 *              explains the gap).
 *  - "pass":    all high-severity rules passed.
 *
 * IMPORTANT: the verdict is rule-compliance, NOT a trade
 * recommendation. "pass" does NOT mean "take this trade".
 */
import {
  priceDiffInPips,
  pipValuePerLot,
  positionSize,
  riskRewardRatio,
} from "@/lib/risk";
import type {
  PlanInput,
  PlanVerdict,
  RuleResult,
} from "@/lib/plan/schema";

// ---------------------------------------------------------------------------
// Config (defaults applied when profile has none)
// ---------------------------------------------------------------------------

/**
 * PlanRulesConfig: the thresholds the engine checks against.
 *
 * These come from the user's profile (default_risk_pct is the only
 * profile field currently surfaced; minRR is not yet on the profile
 * so it has a hard-coded default of 1.5 — a future phase can add it).
 */
export interface PlanRulesConfig {
  /** Max risk per trade, as % of balance. Default 2.0. */
  maxRiskPct: number;
  /** Min risk-reward ratio (reward / risk). Default 1.5. */
  minRR: number;
}

export const DEFAULT_PLAN_RULES: PlanRulesConfig = {
  maxRiskPct: 2.0,
  minRR: 1.5,
};

/**
 * Default account balance used when neither the plan nor the profile
 * supplies one. Lets the rules still run instead of returning
 * "review" with no useful info.
 */
export const DEFAULT_ACCOUNT_BALANCE = 10_000;

/**
 * Default risk % used when neither the plan nor the profile supplies
 * one. Conservative: 1.0%.
 */
export const DEFAULT_RISK_PCT = 1.0;

// ---------------------------------------------------------------------------
// Resolved plan (effective values after fallback)
// ---------------------------------------------------------------------------

/**
 * The plan with all optional values resolved to the value the engine
 * actually used. Returned alongside the rule results so the API can
 * echo it back to the UI ("you didn't specify a balance, so we used
 * your default of $10,000").
 */
export interface ResolvedPlan {
  pair: string;
  direction: "buy" | "sell";
  entry_price: number;
  stop_loss: number;
  take_profit: number | null;
  account_balance: number;
  risk_pct: number;
  lot_size: number | null;
  notes: string;
  /** True if balance came from profile/defaults (not provided by user). */
  balance_inferred: boolean;
  /** True if risk_pct came from profile/defaults (not provided by user). */
  risk_inferred: boolean;
}

/**
 * Resolve the plan's optional fields against the profile.
 *
 * Pure: given the same inputs, returns the same ResolvedPlan.
 */
export function resolvePlan(
  input: PlanInput,
  profile: {
    default_balance?: number | null;
    default_risk_pct?: number | null;
  },
): ResolvedPlan {
  let balance = input.account_balance;
  let balanceInferred = false;
  if (balance == null || !isFinite(balance) || balance <= 0) {
    balance =
      profile.default_balance && profile.default_balance > 0
        ? profile.default_balance
        : DEFAULT_ACCOUNT_BALANCE;
    balanceInferred = true;
  }

  let riskPct = input.risk_pct;
  let riskInferred = false;
  if (riskPct == null || !isFinite(riskPct) || riskPct < 0) {
    riskPct =
      profile.default_risk_pct != null && profile.default_risk_pct > 0
        ? profile.default_risk_pct
        : DEFAULT_RISK_PCT;
    riskInferred = true;
  }

  return {
    pair: input.pair,
    direction: input.direction,
    entry_price: input.entry_price,
    stop_loss: input.stop_loss,
    take_profit: input.take_profit ?? null,
    account_balance: balance,
    risk_pct: riskPct,
    lot_size: input.lot_size ?? null,
    notes: input.notes ?? "",
    balance_inferred: balanceInferred,
    risk_inferred: riskInferred,
  };
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

/**
 * Rule 1: risk per trade (% of balance).
 *
 *  - PASS if riskPct <= config.maxRiskPct.
 *  - FAIL (high) if above.
 */
export function checkRiskPct(
  riskPct: number,
  maxRiskPct: number,
): RuleResult {
  const rule = "Risk per trade";
  if (!isFinite(riskPct) || riskPct < 0) {
    return {
      rule,
      passed: false,
      detail: "Risk % is missing or invalid.",
      severity: "high",
    };
  }
  if (riskPct <= maxRiskPct) {
    return {
      rule,
      passed: true,
      detail: `Risk ${riskPct.toFixed(2)}% <= max ${maxRiskPct.toFixed(2)}%.`,
      severity: "info",
    };
  }
  return {
    rule,
    passed: false,
    detail: `Risk ${riskPct.toFixed(2)}% > max ${maxRiskPct.toFixed(2)}%.`,
    severity: "high",
  };
}

/**
 * Rule 2: risk-reward ratio.
 *
 *  - SKIP (passed=true, info) if no TP provided.
 *  - PASS if RR >= config.minRR.
 *  - FAIL (high) if RR < config.minRR.
 */
export function checkRiskReward(
  pair: string,
  direction: "buy" | "sell",
  entry: number,
  stop: number,
  takeProfit: number | null,
  minRR: number,
): RuleResult {
  const rule = "Risk-reward ratio";
  if (takeProfit == null || !isFinite(takeProfit) || takeProfit <= 0) {
    return {
      rule,
      passed: true,
      detail: "No take-profit provided — risk-reward not evaluated.",
      severity: "info",
    };
  }
  const riskPips = Math.abs(
    priceDiffInPips(pair, entry, stop),
  );
  const rewardPips = Math.abs(
    priceDiffInPips(pair, entry, takeProfit),
  );
  if (riskPips <= 0 || !isFinite(riskPips)) {
    return {
      rule,
      passed: false,
      detail: "Stop-loss distance is zero or invalid.",
      severity: "high",
    };
  }
  const rr = riskRewardRatio(riskPips, rewardPips);
  if (!isFinite(rr) || rr < 0) {
    return {
      rule,
      passed: false,
      detail: "Could not compute risk-reward (invalid TP relative to entry).",
      severity: "high",
    };
  }
  if (rr >= minRR) {
    return {
      rule,
      passed: true,
      detail: `RR ${rr.toFixed(2)} >= min ${minRR.toFixed(2)} (risk ${riskPips.toFixed(1)} pips, reward ${rewardPips.toFixed(1)} pips).`,
      severity: "info",
    };
  }
  return {
    rule,
    passed: false,
    detail: `RR ${rr.toFixed(2)} < min ${minRR.toFixed(2)} (risk ${riskPips.toFixed(1)} pips, reward ${rewardPips.toFixed(1)} pips).`,
    severity: "high",
  };
}

/**
 * Rule 3: stop-loss placement (sanity).
 *
 *  - PASS if SL is on the correct side of entry for the direction.
 *    (This is also enforced by zod, so a validated input should
 *    always pass; included as defense-in-depth.)
 */
export function checkStopLossPlacement(
  direction: "buy" | "sell",
  entry: number,
  stop: number,
): RuleResult {
  const rule = "Stop-loss placement";
  const ok =
    direction === "buy" ? stop < entry : stop > entry;
  if (ok) {
    const distance = Math.abs(entry - stop);
    return {
      rule,
      passed: true,
      detail: `SL is ${distance.toFixed(5)} below (BUY) / above (SELL) entry as required.`,
      severity: "info",
    };
  }
  return {
    rule,
    passed: false,
    detail: "SL is on the wrong side of entry for this direction.",
    severity: "high",
  };
}

/**
 * Rule 4: position size sanity (only checked when lot_size provided).
 *
 * Computes the implied risk % from lot_size + SL distance + pip value.
 * Compares to config.maxRiskPct.
 *
 *  - PASS if implied risk <= maxRiskPct.
 *  - FAIL (medium) if implied risk > maxRiskPct but <= 2x.
 *  - FAIL (high) if implied risk > 2x maxRiskPct (likely a typo).
 *
 *  - SKIP (passed=true, info) if lot_size not provided, with a hint
 *    about the suggested size based on the chosen risk %.
 */
export function checkPositionSize(
  pair: string,
  entry: number,
  stop: number,
  balance: number,
  riskPct: number,
  lotSize: number | null,
  maxRiskPct: number,
): RuleResult {
  const rule = "Position size";

  // Suggested size (info) when user hasn't specified one.
  if (lotSize == null || !isFinite(lotSize) || lotSize <= 0) {
    const slPips = Math.abs(priceDiffInPips(pair, entry, stop));
    const pipVal = pipValuePerLot(pair, entry);
    if (
      slPips > 0 &&
      isFinite(pipVal) &&
      pipVal > 0 &&
      isFinite(balance) &&
      balance > 0 &&
      isFinite(riskPct) &&
      riskPct > 0
    ) {
      const suggested = positionSize(balance, riskPct, slPips, pipVal);
      if (isFinite(suggested) && suggested > 0) {
        return {
          rule,
          passed: true,
          detail: `No lot size provided. Suggested size at ${riskPct.toFixed(2)}% risk: ${suggested.toFixed(2)} lots.`,
          severity: "info",
        };
      }
    }
    return {
      rule,
      passed: true,
      detail: "No lot size provided — position size not evaluated.",
      severity: "info",
    };
  }

  // User provided lot size — check implied risk %.
  const slPips = Math.abs(priceDiffInPips(pair, entry, stop));
  const pipVal = pipValuePerLot(pair, entry);
  if (
    slPips <= 0 ||
    !isFinite(slPips) ||
    !isFinite(pipVal) ||
    pipVal <= 0 ||
    !isFinite(balance) ||
    balance <= 0
  ) {
    return {
      rule,
      passed: false,
      detail: "Cannot evaluate position size (missing or invalid inputs).",
      severity: "medium",
    };
  }
  const riskAmount = lotSize * slPips * pipVal;
  const impliedRiskPct = (riskAmount / balance) * 100;

  if (impliedRiskPct <= maxRiskPct) {
    return {
      rule,
      passed: true,
      detail: `Implied risk ${impliedRiskPct.toFixed(2)}% <= max ${maxRiskPct.toFixed(2)}% (lot ${lotSize}, SL ${slPips.toFixed(1)} pips).`,
      severity: "info",
    };
  }
  if (impliedRiskPct <= maxRiskPct * 2) {
    return {
      rule,
      passed: false,
      detail: `Implied risk ${impliedRiskPct.toFixed(2)}% > max ${maxRiskPct.toFixed(2)}% (lot ${lotSize}).`,
      severity: "medium",
    };
  }
  return {
    rule,
    passed: false,
    detail: `Implied risk ${impliedRiskPct.toFixed(2)}% is more than 2x your max (${maxRiskPct.toFixed(2)}%). Check lot size.`,
    severity: "high",
  };
}

// ---------------------------------------------------------------------------
// Engine entry point
// ---------------------------------------------------------------------------

/**
 * Run all deterministic rules against the resolved plan.
 *
 * Pure: given the same inputs, returns the same RuleResult[].
 * Order is stable so the UI can render rules in the same order
 * every time.
 */
export function evaluateRules(
  plan: ResolvedPlan,
  config: PlanRulesConfig = DEFAULT_PLAN_RULES,
): RuleResult[] {
  const results: RuleResult[] = [];

  results.push(checkRiskPct(plan.risk_pct, config.maxRiskPct));
  results.push(
    checkRiskReward(
      plan.pair,
      plan.direction,
      plan.entry_price,
      plan.stop_loss,
      plan.take_profit,
      config.minRR,
    ),
  );
  results.push(
    checkStopLossPlacement(plan.direction, plan.entry_price, plan.stop_loss),
  );
  results.push(
    checkPositionSize(
      plan.pair,
      plan.entry_price,
      plan.stop_loss,
      plan.account_balance,
      plan.risk_pct,
      plan.lot_size,
      config.maxRiskPct,
    ),
  );

  return results;
}

/**
 * Derive the verdict from the rule results.
 *
 *  - "fail":    any high-severity rule failed.
 *  - "review":  no high failures, but a medium-severity rule failed.
 *  - "pass":    all rules passed (info severity allowed).
 *
 * (Note: "review" is also returned if a rule could not be evaluated
 *  due to missing data — but we currently surface missing data as
 *  passed=true, severity=info, so this case is folded into "pass".
 *  A future phase could split that out.)
 */
export function deriveVerdict(results: RuleResult[]): PlanVerdict {
  const hasHighFail = results.some(
    (r) => !r.passed && r.severity === "high",
  );
  if (hasHighFail) return "fail";

  const hasMediumFail = results.some(
    (r) => !r.passed && r.severity === "medium",
  );
  if (hasMediumFail) return "review";

  return "pass";
}

/**
 * Full evaluation: resolve -> evaluate -> derive verdict.
 * Convenience wrapper used by the API route.
 */
export function evaluatePlan(
  input: PlanInput,
  profile: {
    default_balance?: number | null;
    default_risk_pct?: number | null;
  },
  config: PlanRulesConfig = DEFAULT_PLAN_RULES,
): { plan: ResolvedPlan; rules: RuleResult[]; verdict: PlanVerdict } {
  const plan = resolvePlan(input, profile);
  const rules = evaluateRules(plan, config);
  const verdict = deriveVerdict(rules);
  return { plan, rules, verdict };
}
