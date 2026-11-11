"use client";

/**
 * Aggregate stats panel for the trade journal.
 *
 * Renders the win rate, net PnL, profit factor and a few more
 * headline numbers. Pure presentational component - the parent
 * passes the stats object computed by computeStats().
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatMoney,
  formatPct,
  formatRatio,
  type TradeStats,
} from "@/lib/trades/schema";
import { cn } from "@/lib/utils";

type Props = {
  stats: TradeStats;
};

export function StatsPanel({ stats }: Props) {
  const netPositive = stats.netPnl > 0;
  const netZero = stats.netPnl === 0;
  const brokePlanRatio =
    stats.total > 0 ? stats.brokePlanCount / stats.total : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" aria-label="Trade statistics">
      {/* Net PnL */}
      <Card className="bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Net PnL
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "text-xl font-semibold tabular-nums",
              netZero ? "text-foreground" : netPositive ? "text-emerald-500" : "text-rose-500",
            )}
          >
            {formatMoney(stats.netPnl)}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {stats.closed} closed · {stats.total - stats.closed} open
          </p>
        </CardContent>
      </Card>

      {/* Win rate */}
      <Card className="bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Win rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-semibold tabular-nums">
            {formatPct(stats.winRate)}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {stats.winners}W · {stats.losers}L
          </p>
        </CardContent>
      </Card>

      {/* Profit factor */}
      <Card className="bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Profit factor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-semibold tabular-nums">
            {Number.isFinite(stats.profitFactor) ? formatRatio(stats.profitFactor) : "—"}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            GP {formatMoney(stats.grossProfit)} · GL {formatMoney(stats.grossLoss)}
          </p>
        </CardContent>
      </Card>

      {/* Avg win / loss */}
      <Card className="bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Avg win / loss
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-semibold tabular-nums">
            <span className="text-emerald-500">{formatMoney(stats.avgWin)}</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-rose-500">{formatMoney(stats.avgLoss)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            per closed trade
          </p>
        </CardContent>
      </Card>

      {/* Followed-plan compliance - second row */}
      <Card className="bg-card/60 col-span-2 sm:col-span-3 lg:col-span-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Plan discipline
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 pt-0">
          <Badge
            variant={brokePlanRatio === 0 ? "default" : "secondary"}
            className={cn(
              brokePlanRatio === 0
                ? "bg-emerald-600 text-white"
                : brokePlanRatio > 0.3
                  ? "bg-rose-600 text-white"
                  : "bg-amber-500 text-black",
            )}
          >
            {stats.brokePlanCount} / {stats.total} broke plan
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatPct(1 - brokePlanRatio)} compliance
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
