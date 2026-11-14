"use client";

/**
 * Performance breakdown explorer.
 *
 * Slices the user's trades by one dimension at a time (session /
 * strategy / pair / emotion / mistake type) and renders per-group
 * stats with a headline insight ("your London-session expectancy is
 * +X.XXR, your worst is ...").
 *
 * All data arrives pre-fetched from the server page; the client only
 * switches tabs and renders. Stats are computed by the pure
 * breakdown() helper in src/lib/trades/breakdown.ts (same file the
 * server + AI routes use).
 */
import { useState } from "react";
import { Lightbulb } from "lucide-react";
import {
  BREAKDOWN_DIMENSIONS,
  breakdown,
  breakdownInsight,
  type BreakdownDimension,
} from "@/lib/trades/breakdown";
import { formatMoney, formatPct, formatRatio, type TradeRow } from "@/lib/trades/schema";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TAB_LABELS: Record<BreakdownDimension, string> = {
  session: "Session",
  strategy: "Strategy",
  pair: "Pair",
  emotion: "Emotion",
  mistakeType: "Mistakes",
};

export function BreakdownClient({ trades }: { trades: TradeRow[] }) {
  const [dim, setDim] = useState<BreakdownDimension>("session");

  return (
    <Tabs value={dim} onValueChange={(v) => setDim(v as BreakdownDimension)} className="space-y-4">
      <TabsList className="flex-wrap">
        {BREAKDOWN_DIMENSIONS.map((d) => (
          <TabsTrigger key={d} value={d}>
            {TAB_LABELS[d]}
          </TabsTrigger>
        ))}
      </TabsList>

      {BREAKDOWN_DIMENSIONS.map((d) => (
        <TabsContent key={d} value={d}>
          <DimensionPanel trades={trades} dimension={d} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function DimensionPanel({
  trades,
  dimension,
}: {
  trades: TradeRow[];
  dimension: BreakdownDimension;
}) {
  const groups = breakdown(trades, dimension);
  const insight = breakdownInsight(groups);

  return (
    <div className="space-y-4">
      {insight && <InsightCallout insight={insight} dimension={dimension} />}
      <BreakdownTable groups={groups} />
    </div>
  );
}

function InsightCallout({
  insight,
  dimension,
}: {
  insight: { best: { key: string; avgR: number | null; winRate: number }; worst: { key: string; avgR: number | null; winRate: number } };
  dimension: BreakdownDimension;
}) {
  const label = TAB_LABELS[dimension].toLowerCase();
  const fmtR = (r: number | null) => (r == null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`);
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-3.5 py-2.5">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="text-xs leading-relaxed text-foreground/90">
        Your best {label} is <strong>{insight.best.key}</strong> with an average
        of <strong className="text-emerald-500">{fmtR(insight.best.avgR)}</strong>{" "}
        and a {formatPct(insight.best.winRate, 0)} win rate. Your weakest is{" "}
        <strong>{insight.worst.key}</strong> at{" "}
        <strong className="text-rose-500">{fmtR(insight.worst.avgR)}</strong> (
        {formatPct(insight.worst.winRate, 0)} win rate). Advisory only — this is
        a pattern in your own journal, not a prediction.
      </p>
    </div>
  );
}

function BreakdownTable({ groups }: { groups: ReturnType<typeof breakdown> }) {
  if (groups.length === 0) {
    return (
      <div className="card-surface p-8 text-center text-sm text-muted-foreground">
        No trades to analyze yet.
      </div>
    );
  }

  const maxAbsPnl = Math.max(...groups.map((g) => Math.abs(g.netPnl)), 1);

  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground/80">
            <th className="px-4 py-2.5 font-medium">Group</th>
            <th className="px-3 py-2.5 text-right font-medium">Trades</th>
            <th className="px-3 py-2.5 font-medium">Win rate</th>
            <th className="px-3 py-2.5 text-right font-medium">Net P&L</th>
            <th className="px-3 py-2.5 text-right font-medium">Profit factor</th>
            <th className="px-3 py-2.5 text-right font-medium">Avg R</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {groups.map((g) => {
            const pnlPositive = g.netPnl > 0;
            const pnlNeutral = g.netPnl === 0;
            // PnL bar: width proportional to |netPnl|, direction by color.
            const barW = (Math.abs(g.netPnl) / maxAbsPnl) * 100;
            return (
              <tr key={g.key} className="transition-colors hover:bg-muted/40">
                <td className="px-4 py-2.5 font-medium">{g.key}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {g.total}
                  <span className="text-[10px] text-muted-foreground/70"> ({g.closed})</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${g.winRate >= 0.5 ? "bg-emerald-500" : "bg-amber-500"}`}
                        style={{ width: `${Math.round(g.winRate * 100)}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-muted-foreground">
                      {formatPct(g.winRate, 0)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span
                      className={`tabular-nums font-medium ${
                        pnlNeutral ? "text-muted-foreground" : pnlPositive ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {formatMoney(g.netPnl)}
                    </span>
                    <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`absolute h-full rounded-full ${pnlPositive ? "left-1/2 bg-emerald-500" : "right-1/2 bg-rose-500"}`}
                        style={{ width: `${barW / 2}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {g.profitFactor != null ? formatRatio(g.profitFactor) : "—"}
                </td>
                <td
                  className={`px-3 py-2.5 text-right font-medium tabular-nums ${
                    g.avgR == null
                      ? "text-muted-foreground"
                      : g.avgR > 0
                        ? "text-emerald-500"
                        : "text-rose-500"
                  }`}
                >
                  {g.avgR != null ? `${g.avgR > 0 ? "+" : ""}${g.avgR.toFixed(2)}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
