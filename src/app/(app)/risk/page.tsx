/**
 * /risk - R-multiple dashboard + exposure (Features 1 + 3).
 *
 * Server Component: pulls trades + goals + profile via the Prisma-
 * backed query helpers (scoped to the authenticated user), runs the
 * pure risk + exposure functions, and passes the result to the client
 * components that render the recharts visualisations.
 */
import { PageHeader } from "@/components/layout/page-header";
import { RiskDashboard } from "@/components/risk/risk-dashboard";
import { ExposurePanel } from "@/components/risk/exposure-panel";
import { Card, CardContent } from "@/components/ui/card";
import { getUserOrNull } from "@/lib/auth";
import { fetchUserTrades } from "@/lib/trades/queries";
import { getGoals } from "@/lib/goals/queries";
import { getProfile } from "@/lib/profile/queries";
import {
  rStats,
  rDistribution,
  rEquityCurve,
  checkLossLimits,
} from "@/lib/trades/risk-analytics";
import { exposureSummary } from "@/lib/trades/exposure";

export const metadata = {
  title: "Risk Dashboard · ForexMind",
  description: "R-multiple analytics, expectancy, loss limits and live exposure.",
};

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const user = await getUserOrNull();
  if (!user) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Risk Dashboard"
          description="R-multiple analytics, expectancy, drawdown and live exposure."
        />
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Sign in to see your R-multiple analytics and live exposure.
          </CardContent>
        </Card>
      </div>
    );
  }

  // fetchUserTrades/getGoals/getProfile all authenticate the caller
  // internally (user is non-null here). nullsFirst puts open trades
  // (null closed_at) at the top of the asc-by-closed_at ordering.
  const [trades, goals, profile] = await Promise.all([
    fetchUserTrades({ orderBy: "closedAt", order: "asc", nullsFirst: true, limit: 200 }),
    getGoals(),
    getProfile(),
  ]);

  const lossLimits = checkLossLimits(trades, {
    maxDailyLossPct: goals.max_daily_loss_pct ?? null,
    maxTradesPerDay: goals.max_trades_per_day ?? null,
    balanceForPct: profile.default_balance ?? null,
  });

  const stats = rStats(trades);
  const dist = rDistribution(trades);
  const curve = rEquityCurve(trades);
  const exposure = exposureSummary(trades);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk Dashboard"
        description="R-multiple analytics, expectancy, drawdown and live exposure."
      />
      <RiskDashboard
        rStats={stats}
        rDistribution={dist}
        rEquityCurve={curve}
        lossLimits={lossLimits}
        tradeCountWithR={stats.expectancy.count}
      />
      <ExposurePanel summary={exposure} />
    </div>
  );
}
