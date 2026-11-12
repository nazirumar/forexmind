/**
 * Trading Goals - DETERMINISTIC rule engine.
 *
 * Pure functions: input is the user's recent closed trades + their
 * goals row; output is a list of GoalViolation with dates + severity.
 *
 * No DB access, no AI. Trivially testable.
 *
 * Rules evaluated (each only when the corresponding goal field is set):
 *
 *  1. max_trades_per_day   - any UTC day with more closed trades than
 *                            the limit is a violation (high).
 *  2. max_daily_loss_pct   - any UTC day where the sum of pnl (as a %
 *                            of an implied balance) exceeds the limit
 *                            is a violation (high). We use the first
 *                            trade's implied balance (entry * lot *
 *                            pipValueApprox) as a rough proxy when no
 *                            balance is supplied; the caller can pass
 *                            a real balance for accuracy.
 *  3. min_rr_target        - any closed trade with RR below the target
 *                            is a violation (medium). RR is computed
 *                            from entry/SL/TP if available.
 *  4. max_consecutive_losses - any run of N+ consecutive losing trades
 *                            is a violation (high), one per run.
 *  5. require_followed_plan - any trade with followed_plan=false is a
 *                            violation (medium).
 */
import type { GoalsRow } from "@/lib/goals/schema";
import type { TradeRow } from "@/lib/trades/schema";
import { priceDiffInPips, pipSize } from "@/lib/risk";

export type GoalSeverity = "high" | "medium" | "low";

export type GoalViolation = {
  /** Machine-readable rule key. */
  rule:
    | "max_trades_per_day"
    | "max_daily_loss_pct"
    | "min_rr_target"
    | "max_consecutive_losses"
    | "require_followed_plan";
  /** Human-readable description of what happened. */
  message: string;
  severity: GoalSeverity;
  /** ISO date (YYYY-MM-DD) or ISO timestamp the violation occurred. */
  at: string;
  /** Numeric detail (e.g. the actual count, the actual RR). */
  actual: number;
  /** The goal threshold that was breached. */
  threshold: number;
};

/**
 * Compute the risk-reward ratio of a single trade from its prices.
 * Returns NaN if any price is missing or the trade has no TP.
 */
function tradeRR(t: TradeRow): number {
  if (t.take_profit == null) return NaN;
  const risk = Math.abs(t.entry_price - t.stop_loss);
  if (risk <= 0) return NaN;
  const reward = Math.abs(t.take_profit - t.entry_price);
  return reward / risk;
}

/**
 * Evaluate recent trades against the user's goals.
 *
 *  - trades: closed trades (open trades are skipped where they don't
 *    apply). Sorted internally by opened_at ascending for consecutive-
 *    loss detection.
 *  - goals: the user's goals row. NULL fields are skipped.
 *  - balance: optional account balance for the daily-loss-% rule. If
 *    not supplied, we estimate from the first trade's notional.
 *
 * Pure. Returns violations sorted by date ascending.
 */
export function evaluateGoals(
  trades: TradeRow[],
  goals: GoalsRow,
  balance?: number,
): GoalViolation[] {
  const violations: GoalViolation[] = [];
  const closed = trades
    .filter((t) => t.pnl != null && Number.isFinite(t.pnl))
    .sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at));

  // --- Rule 1: max trades per day ---
  if (goals.max_trades_per_day != null) {
    const byDay = new Map<string, number>();
    for (const t of closed) {
      const day = t.opened_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    for (const [day, count] of byDay) {
      if (count > goals.max_trades_per_day) {
        violations.push({
          rule: "max_trades_per_day",
          message: `${count} trades on ${day} (limit ${goals.max_trades_per_day}).`,
          severity: "high",
          at: day,
          actual: count,
          threshold: goals.max_trades_per_day,
        });
      }
    }
  }

  // --- Rule 2: max daily loss % ---
  if (goals.max_daily_loss_pct != null) {
    // Group pnl by day, sum. A day is a violation if its summed pnl is
    // negative AND |sum| / balance * 100 > limit.
    const byDay = new Map<string, number>();
    for (const t of closed) {
      const day = t.opened_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + (t.pnl as number));
    }
    // Estimate a balance if none supplied: use the largest single-trade
    // notional as a rough proxy so the % isn't wildly off for tiny accounts.
    const impliedBalance =
      balance ??
      (closed.length > 0
        ? Math.max(
            ...closed.map((t) =>
              Math.abs(t.entry_price * t.lot_size * 100_000),
            ),
          )
        : 10_000);
    for (const [day, sum] of byDay) {
      if (sum >= 0) continue;
      const lossPct = (Math.abs(sum) / impliedBalance) * 100;
      if (lossPct > goals.max_daily_loss_pct) {
        violations.push({
          rule: "max_daily_loss_pct",
          message: `Lost ${lossPct.toFixed(1)}% of balance on ${day} (limit ${goals.max_daily_loss_pct}%).`,
          severity: "high",
          at: day,
          actual: Number(lossPct.toFixed(2)),
          threshold: goals.max_daily_loss_pct,
        });
      }
    }
  }

  // --- Rule 3: min RR target ---
  if (goals.min_rr_target != null) {
    for (const t of closed) {
      const rr = tradeRR(t);
      if (!Number.isFinite(rr)) continue; // no TP -> can't evaluate
      if (rr < goals.min_rr_target) {
        violations.push({
          rule: "min_rr_target",
          message: `${t.pair} ${t.direction} RR ${rr.toFixed(2)} below target ${goals.min_rr_target}.`,
          severity: "medium",
          at: t.opened_at,
          actual: Number(rr.toFixed(2)),
          threshold: goals.min_rr_target,
        });
      }
    }
  }

  // --- Rule 4: max consecutive losses ---
  if (goals.max_consecutive_losses != null) {
    let run = 0;
    let runStart: string | null = null;
    for (const t of closed) {
      if ((t.pnl as number) < 0) {
        if (run === 0) runStart = t.opened_at;
        run += 1;
        if (run > goals.max_consecutive_losses) {
          violations.push({
            rule: "max_consecutive_losses",
            message: `${run} consecutive losses starting ${runStart}.`,
            severity: "high",
            at: t.opened_at,
            actual: run,
            threshold: goals.max_consecutive_losses,
          });
        }
      } else {
        run = 0;
        runStart = null;
      }
    }
  }

  // --- Rule 5: require followed plan ---
  if (goals.require_followed_plan) {
    for (const t of closed) {
      if (!t.followed_plan) {
        violations.push({
          rule: "require_followed_plan",
          message: `${t.pair} ${t.direction} on ${t.opened_at.slice(0, 10)} did not follow your plan.`,
          severity: "medium",
          at: t.opened_at,
          actual: 0,
          threshold: 1,
        });
      }
    }
  }

  return violations.sort((a, b) => a.at.localeCompare(b.at));
}

/** Count violations by severity. Pure. */
export function violationSummary(violations: GoalViolation[]): {
  high: number;
  medium: number;
  low: number;
  total: number;
} {
  let high = 0,
    medium = 0,
    low = 0;
  for (const v of violations) {
    if (v.severity === "high") high += 1;
    else if (v.severity === "medium") medium += 1;
    else low += 1;
  }
  return { high, medium, low, total: violations.length };
}
