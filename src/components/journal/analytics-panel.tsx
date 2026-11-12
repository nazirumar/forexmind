"use client";

/**
 * Analytics Panel - charts for the trade journal.
 *
 * Uses recharts (already installed since Phase 1) wrapped in the
 * shadcn ChartContainer so the colors respect the dark theme tokens.
 *
 * Charts:
 *  1. Equity curve (area chart) - running PnL over time, with peak
 *     overlay so drawdowns are visible as the gap between the two.
 *  2. Per-pair net PnL (horizontal bar chart) - which pairs make
 *     money, which lose. Sorted best-to-worst by the pure function.
 *  3. Per-session win rate (vertical bar chart) - which sessions have
 *     the highest win rate. Color-coded by PnL sign.
 *  4. P&L distribution histogram - shows whether the user's typical
 *     trade is small-win/big-loss or balanced.
 *  5. Per-weekday net PnL (vertical bar chart) - "do I lose on
 *     Mondays?" pattern detection.
 *
 * All charts are PURE-presentational: the parent passes the trades
 * array (already filtered by pair/direction); this component computes
 * the chart data via the pure analytics functions.
 */
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis, Area, AreaChart, ReferenceLine } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  perPairStats,
  perSessionStats,
  perTagStats,
  drawdownSeries,
  pnlDistribution,
  perWeekdayStats,
  analyticsSummary,
} from "@/lib/trades/analytics";
import {
  equityCurve,
  formatMoney,
  formatPair,
  formatPct,
  type TradeRow,
} from "@/lib/trades/schema";
import { Hash } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  trades: TradeRow[];
};

const EQUITY_CONFIG: ChartConfig = {
  equity: { label: "Equity", color: "hsl(var(--chart-1))" },
  peak: { label: "Peak", color: "hsl(var(--chart-5))" },
};

const PAIR_CONFIG: ChartConfig = {
  net: { label: "Net PnL", color: "hsl(var(--chart-2))" },
};

const SESSION_CONFIG: ChartConfig = {
  winRate: { label: "Win rate", color: "hsl(var(--chart-3))" },
};

const DIST_CONFIG: ChartConfig = {
  count: { label: "Trades", color: "hsl(var(--chart-4))" },
};

const WEEKDAY_CONFIG: ChartConfig = {
  net: { label: "Net PnL", color: "hsl(var(--chart-2))" },
};

export function AnalyticsPanel({ trades }: Props) {
  const summary = useMemo(() => analyticsSummary(trades), [trades]);
  const series = useMemo(() => drawdownSeries(trades), [trades]);
  const pairs = useMemo(() => perPairStats(trades), [trades]);
  const sessions = useMemo(() => perSessionStats(trades), [trades]);
  const buckets = useMemo(() => pnlDistribution(trades), [trades]);
  const weekdays = useMemo(() => perWeekdayStats(trades), [trades]);
  const tags = useMemo(() => perTagStats(trades), [trades]);
  const equity = useMemo(() => equityCurve(trades), [trades]);

  // Equity curve: we use drawdownSeries because it includes both
  // equity and peak; equityCurve (from schema.ts) only has equity.
  // We need both lines for the drawdown visualization.
  const equityData = series.map((p, i) => ({
    at: p.at,
    equity: p.equity,
    peak: p.peak,
    idx: i,
  }));

  // Per-pair: cap at top 8 pairs to keep the chart readable.
  const pairsData = pairs.slice(0, 8).map((p) => ({
    pair: formatPair(p.pair),
    net: p.netPnl,
    winRate: p.winRate,
    total: p.total,
  }));

  // Per-session: filter out sessions with 0 trades (don't clutter).
  const sessionsData = sessions
    .filter((s) => s.total > 0)
    .map((s) => ({
      session: s.session === "unspecified" ? "—" : s.session.charAt(0).toUpperCase() + s.session.slice(1),
      winRate: Math.round(s.winRate * 100),
      net: s.netPnl,
      total: s.total,
    }));

  // P&L distribution
  const distData = buckets.map((b) => ({
    label: b.label,
    count: b.count,
    from: b.from,
  }));

  // Weekday
  const weekdayData = weekdays.map((w) => ({
    label: w.label,
    net: w.netPnl,
    total: w.total,
  }));

  if (summary.closedCount < 3) {
    return (
      <Card className="border-dashed bg-card/50">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Analytics unlock at <strong>3 closed trades</strong>. You have{" "}
            <strong>{summary.closedCount}</strong> so far.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Close a few trades in your journal to see the equity curve, per-pair
            breakdown, drawdown, and trading-session patterns here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Closed trades"
          value={String(summary.closedCount)}
        />
        <SummaryCard
          label="Best pair"
          value={summary.bestPair ? formatPair(summary.bestPair.pair) : "—"}
          sub={summary.bestPair ? formatMoney(summary.bestPair.netPnl) : ""}
          tone="positive"
        />
        <SummaryCard
          label="Worst pair"
          value={summary.worstPair ? formatPair(summary.worstPair.pair) : "—"}
          sub={summary.worstPair ? formatMoney(summary.worstPair.netPnl) : ""}
          tone="negative"
        />
        <SummaryCard
          label="Max drawdown"
          value={summary.maxDrawdown ? `${summary.maxDrawdown.pct.toFixed(1)}%` : "—"}
          sub={summary.maxDrawdown ? formatMoney(summary.maxDrawdown.value) : ""}
          tone="negative"
        />
        <SummaryCard
          label="Best win streak"
          value={String(summary.longestWinStreak)}
          sub="in a row"
          tone="positive"
        />
        <SummaryCard
          label="Worst loss streak"
          value={String(summary.longestLossStreak)}
          sub="in a row"
          tone={summary.longestLossStreak >= 3 ? "negative" : "neutral"}
        />
      </div>

      {/* Equity curve with drawdown */}
      {equityData.length >= 2 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Equity curve</CardTitle>
              <div className="flex gap-3 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-sm bg-[hsl(var(--chart-1))]" />
                  Equity
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-sm bg-[hsl(var(--chart-5))]" />
                  Peak (drawdown = gap)
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ChartContainer config={EQUITY_CONFIG} className="aspect-[4/1] w-full">
              <AreaChart data={equityData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <defs>
                  <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="at"
                  tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `$${v}`}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const p = payload?.[0]?.payload as { at: string } | undefined;
                        return p ? new Date(p.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
                      }}
                      formatter={(value) => formatMoney(Number(value))}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="peak"
                  stroke="hsl(var(--chart-5))"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fill="none"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  fill="url(#equityFill)"
                  isAnimationActive={false}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="2 2" />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* Per-pair + per-session side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {pairsData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Per-pair net PnL</CardTitle>
              <p className="text-xs text-muted-foreground">
                Top {pairsData.length} pairs by net PnL. Hover for win rate.
              </p>
            </CardHeader>
            <CardContent>
              <ChartContainer config={PAIR_CONFIG} className="aspect-[3/2] w-full">
                <BarChart data={pairsData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `$${v}`}
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="pair"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={70}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, _name, item) => {
                          const p = item.payload as { winRate: number; total: number };
                          return (
                            <div className="text-xs">
                              <div className="font-medium">{formatMoney(Number(value))}</div>
                              <div className="text-muted-foreground">
                                Win rate: {(p.winRate * 100).toFixed(0)}% · {p.total} trades
                              </div>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <ReferenceLine x={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="net" radius={4} isAnimationActive={false}>
                    {pairsData.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={entry.net >= 0 ? "hsl(var(--chart-2))" : "hsl(var(--destructive))"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        {sessionsData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Win rate by session</CardTitle>
              <p className="text-xs text-muted-foreground">
                Hover for net PnL and trade count.
              </p>
            </CardHeader>
            <CardContent>
              <ChartContainer config={SESSION_CONFIG} className="aspect-[3/2] w-full">
                <BarChart data={sessionsData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="session"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, _name, item) => {
                          const p = item.payload as { net: number; total: number };
                          return (
                            <div className="text-xs">
                              <div className="font-medium">{value}% win rate</div>
                              <div className="text-muted-foreground">
                                Net: {formatMoney(p.net)} · {p.total} trades
                              </div>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <Bar dataKey="winRate" radius={4} isAnimationActive={false}>
                    {sessionsData.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={
                          entry.net >= 0
                            ? "hsl(var(--chart-3))"
                            : "hsl(var(--destructive))"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* P&L distribution + weekday */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {distData.length > 1 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">P&amp;L distribution</CardTitle>
              <p className="text-xs text-muted-foreground">
                How your trade outcomes cluster. Look for the balance of small wins vs big losses.
              </p>
            </CardHeader>
            <CardContent>
              <ChartContainer config={DIST_CONFIG} className="aspect-[3/2] w-full">
                <BarChart data={distData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => `${value} trade${Number(value) === 1 ? "" : "s"}`}
                      />
                    }
                  />
                  <Bar dataKey="count" radius={4} isAnimationActive={false}>
                    {distData.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={
                          entry.from >= 0
                            ? "hsl(var(--chart-2))"
                            : "hsl(var(--destructive))"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        {weekdayData.some((w) => w.total > 0) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Net PnL by weekday</CardTitle>
              <p className="text-xs text-muted-foreground">
                Do you lose on Mondays? Win on Fridays? Pattern detection across the trading week.
              </p>
            </CardHeader>
            <CardContent>
              <ChartContainer config={WEEKDAY_CONFIG} className="aspect-[3/2] w-full">
                <BarChart data={weekdayData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `$${v}`}
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, _name, item) => {
                          const p = item.payload as { total: number };
                          return (
                            <div className="text-xs">
                              <div className="font-medium">{formatMoney(Number(value))}</div>
                              <div className="text-muted-foreground">{p.total} trades</div>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="net" radius={4} isAnimationActive={false}>
                    {weekdayData.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={
                          entry.net >= 0
                            ? "hsl(var(--chart-2))"
                            : "hsl(var(--destructive))"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tag breakdown (Phase 18) */}
      {tags.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-1.5">
              <Hash className="h-4 w-4" aria-hidden="true" />
              Per-tag breakdown
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              A trade with multiple tags counts in every bucket. Look for
              tags with low win rates or large negative net PnL - those are
              the setups worth re-examining.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Tag</th>
                    <th className="pb-2 text-right font-medium">Trades</th>
                    <th className="pb-2 text-right font-medium">Win rate</th>
                    <th className="pb-2 text-right font-medium">Net PnL</th>
                    <th className="pb-2 text-right font-medium">Avg PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((t) => (
                    <tr key={t.tag} className="border-t border-border/50">
                      <td className="py-2">
                        <span className="inline-flex items-center gap-0.5 font-medium">
                          <Hash className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                          {t.tag}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{t.total}</td>
                      <td className="py-2 text-right tabular-nums">
                        <span
                          className={cn(
                            t.winRate >= 0.5
                              ? "text-emerald-500"
                              : t.winRate > 0
                                ? "text-amber-500"
                                : "text-muted-foreground",
                          )}
                        >
                          {formatPct(t.winRate)}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "py-2 text-right tabular-nums font-medium",
                          t.netPnl > 0
                            ? "text-emerald-500"
                            : t.netPnl < 0
                              ? "text-rose-500"
                              : "text-muted-foreground",
                        )}
                      >
                        {formatMoney(t.netPnl)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {formatMoney(t.avgPnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Holding time + plan discipline summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Behavioral stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Avg holding time</div>
              <div className="font-semibold tabular-nums">
                {summary.avgHoldMinutes != null
                  ? formatHoldTime(summary.avgHoldMinutes)
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Best win streak</div>
              <div className="font-semibold tabular-nums text-emerald-500">
                {summary.longestWinStreak} trades
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Worst loss streak</div>
              <div
                className={cn(
                  "font-semibold tabular-nums",
                  summary.longestLossStreak >= 3 ? "text-rose-500" : "",
                )}
              >
                {summary.longestLossStreak} trades
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Closed</div>
              <div className="font-semibold tabular-nums">{summary.closedCount} trades</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Not financial advice. Trading forex involves substantial risk of loss.
        Analytics reflect your own journal data only.
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-500"
      : tone === "negative"
        ? "text-rose-500"
        : "text-foreground";
  return (
    <Card className="bg-card/60">
      <CardContent className="py-3">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-sm font-semibold tabular-nums truncate", toneClass)}>
          {value}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function formatHoldTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const d = Math.floor(minutes / (60 * 24));
  const h = Math.round((minutes % (60 * 24)) / 60);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}
