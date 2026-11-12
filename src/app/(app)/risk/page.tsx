/**
 * /risk - R-multiple dashboard + exposure (Features 1 + 3).
 *
 * Server Component: pulls trades + goals + profile directly from
 * Supabase (RLS scopes them to the user), runs the pure risk + exposure
 * functions, and passes the result to the client components that render
 * the recharts visualisations.
 */
import { PageHeader } from "@/components/layout/page-header";
import { RiskDashboard } from "@/components/risk/risk-dashboard";
import { ExposurePanel } from "@/components/risk/exposure-panel";
import { Card, CardContent } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserOrNull } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { tradeRowSchema, type TradeRow } from "@/lib/trades/schema";
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
  if (!isSupabaseConfigured()) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Risk Dashboard"
          description="R-multiple analytics, expectancy, drawdown and live exposure."
        />
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Supabase is not configured. Set your project URL + publishable
            key in <code>.env.local</code> to enable the risk dashboard.
          </CardContent>
        </Card>
      </div>
    );
  }

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

  const supabase = await createSupabaseServerClient();

  const [tradesRes, goalsRes, profileRes] = await Promise.all([
    supabase
      .from("trades")
      .select("*")
      .eq("user_id", user.id)
      .order("closed_at", { ascending: true, nullsFirst: true })
      .limit(200),
    supabase
      .from("trading_goals")
      .select("max_daily_loss_pct, max_trades_per_day")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("default_balance")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const trades: TradeRow[] = (tradesRes.data ?? []).map((d) => {
    // parse + tolerate rows that predate the new columns (they come
    // back without the risk_* fields, which the schema marks optional).
    const parsed = tradeRowSchema.safeParse(d);
    return parsed.success ? parsed.data : (d as unknown as TradeRow);
  });

  const goals = goalsRes.data as
    | { max_daily_loss_pct: number | null; max_trades_per_day: number | null }
    | null;
  const profile = profileRes.data as { default_balance: number | null } | null;

  const lossLimits = checkLossLimits(trades, {
    maxDailyLossPct: goals?.max_daily_loss_pct ?? null,
    maxTradesPerDay: goals?.max_trades_per_day ?? null,
    balanceForPct: profile?.default_balance ?? null,
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
