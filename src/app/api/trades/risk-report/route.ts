/**
 * GET /api/trades/risk-report
 *   R-multiple analytics + loss-limit status for the risk dashboard.
 *
 * Returns JSON (not a PDF - that's /api/trades/report). Includes:
 *  - rStats: expectancy, best/worst R, total R, full winners/losers,
 *    blown stops (trades worse than -1R).
 *  - rDistribution: 0.5R-wide histogram of realized R.
 *  - rEquityCurve: cumulative R over closed trades.
 *  - lossLimits: today/week PnL + whether the daily loss limit is hit,
 *    computed against the user's trading_goals + profile balance.
 *
 * Auth required. Rate-limited (read bucket). All computation is in
 * pure functions (src/lib/trades/risk-analytics.ts) so this route is a
 * thin fetch + compute wrapper.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import { fetchUserTrades } from "@/lib/trades/queries";
import { getGoals } from "@/lib/goals/queries";
import { getProfile } from "@/lib/profile/queries";
import {
  rStats,
  rDistribution,
  rEquityCurve,
  checkLossLimits,
} from "@/lib/trades/risk-analytics";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;

    // Fetch up to 200 trades (closed+open), most recently closed first.
    // R analytics only use closed trades with risk_amount; loss limits
    // use today's closed trades. getGoals/getProfile return defaults
    // (all-null) when the user hasn't saved any yet.
    const [trades, goals, profile] = await Promise.all([
      fetchUserTrades({ orderBy: "closedAt", order: "desc", limit: 200 }),
      getGoals(),
      getProfile(),
    ]);

    const lossLimits = checkLossLimits(trades, {
      maxDailyLossPct: goals.max_daily_loss_pct ?? null,
      maxTradesPerDay: goals.max_trades_per_day ?? null,
      balanceForPct: profile.default_balance ?? null,
    });

    const body = {
      rStats: rStats(trades),
      rDistribution: rDistribution(trades),
      rEquityCurve: rEquityCurve(trades),
      lossLimits,
      tradeCountWithR: rStats(trades).expectancy.count,
    };

    return NextResponse.json(body, { headers: rl.headers });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/trades/risk-report] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
