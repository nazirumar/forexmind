"use client";

/**
 * Risk dashboard (Feature 1) - R-multiple analytics + loss-limit guard.
 *
 * Client component: receives pre-computed risk data as props (the server
 * page fetches trades + goals and runs the pure functions in
 * src/lib/trades/risk-analytics.ts) and renders:
 *  - headline R stats (expectancy, total R, best/worst, blown stops)
 *  - R-distribution histogram (recharts BarChart)
 *  - R-equity curve (recharts AreaChart) - the "are you trending up in R?" curve
 *  - daily loss-limit banner (warning when breached)
 *
 * R = pnl / risk_amount. Trades without a recorded risk_amount are
 * excluded from R analytics (they still appear in the $ stats on the
 * journal page).
 */
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, ReferenceLine, CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, TrendingUp, TrendingDown, Activity, Gauge } from "lucide-react";
import type {
  RStats,
  RBucket,
  REquityPoint,
  LossLimitStatus,
} from "@/lib/trades/risk-analytics";

type Props = {
  rStats: RStats;
  rDistribution: RBucket[];
  rEquityCurve: REquityPoint[];
  lossLimits: LossLimitStatus;
  tradeCountWithR: number;
};

function fmtR(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function fmtMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function RiskDashboard({
  rStats, rDistribution, rEquityCurve, lossLimits, tradeCountWithR,
}: Props) {
  const { expectancy } = rStats;
  const positiveExpectancy = expectancy.expectancyR > 0;

  return (
    <div className="space-y-4">
      {/* Loss-limit banner */}
      {lossLimits.warning && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{lossLimits.warning}</span>
        </div>
      )}

      {/* Headline R stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Expectancy"
          value={fmtR(expectancy.expectancyR)}
          sub={`per trade (${expectancy.count} trades with R data)`}
          positive={positiveExpectancy}
          icon={Gauge}
        />
        <StatCard
          label="Total R"
          value={fmtR(rStats.totalR)}
          sub="cumulative realized R"
          positive={rStats.totalR > 0}
          icon={Activity}
        />
        <StatCard
          label="Best trade"
          value={fmtR(rStats.bestR)}
          sub={`worst: ${fmtR(rStats.worstR)}`}
          icon={TrendingUp}
        />
        <StatCard
          label="Blown stops"
          value={rStats.blownStops > 0 ? String(rStats.blownStops) : "0"}
          sub={`trades worse than -1R${rStats.blownStops > 0 ? " (moved/no stop)" : ""}`}
          warning={rStats.blownStops > 0}
          icon={TrendingDown}
        />
      </div>

      {/* Expectancy breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Expectancy breakdown</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {expectancy.count === 0 ? (
            <p>
              No trades with recorded risk amount yet. Log a trade with an account
              balance + risk % (or risk $) to see R-multiple analytics here.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="Win rate" value={`${(expectancy.winRate * 100).toFixed(0)}%`} />
              <Metric label="Avg win" value={fmtR(expectancy.avgWinR)} positive />
              <Metric label="Avg loss" value={fmtR(expectancy.avgLossR)} negative />
              <Metric
                label="Full winners"
                value={String(rStats.fullWinners)}
                sub="trades ≥ +1R"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* R-distribution histogram */}
      {rDistribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">R-distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={rDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                />
                <ReferenceLine x="0R" stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* R-equity curve */}
      {rEquityCurve.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">R-equity curve</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={rEquityCurve}>
                <defs>
                  <linearGradient id="rEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis dataKey="at" tick={{ fontSize: 10 }} tickFormatter={(s: string) => s?.slice(5, 10)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                  formatter={(v: number) => [fmtR(v), "R-equity"]}
                  labelFormatter={(s: string) => s?.slice(0, 16)}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
                <Area
                  type="monotone"
                  dataKey="rEquity"
                  stroke="hsl(var(--primary))"
                  fill="url(#rEquity)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Daily/weekly PnL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Today & this week</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Metric label="Trades today" value={String(lossLimits.todayTrades)} />
            <Metric
              label="PnL today"
              value={fmtMoney(lossLimits.todayPnl)}
              positive={lossLimits.todayPnl > 0}
              negative={lossLimits.todayPnl < 0}
            />
            <Metric
              label="R today"
              value={lossLimits.todayR != null ? fmtR(lossLimits.todayR) : "—"}
              positive={lossLimits.todayR != null && lossLimits.todayR > 0}
              negative={lossLimits.todayR != null && lossLimits.todayR < 0}
            />
            <Metric label="Trades this week" value={String(lossLimits.weekTrades)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label, value, sub, positive, negative, warning, icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  negative?: boolean;
  warning?: boolean;
  icon: typeof Activity;
}) {
  const color = warning
    ? "text-rose-400"
    : positive
      ? "text-emerald-400"
      : negative
        ? "text-rose-400"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-3.5 w-3.5 ${color}`} aria-hidden="true" />
        </div>
        <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Metric({
  label, value, sub, positive, negative,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const color = positive
    ? "text-emerald-400"
    : negative
      ? "text-rose-400"
      : "text-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-base font-medium ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
