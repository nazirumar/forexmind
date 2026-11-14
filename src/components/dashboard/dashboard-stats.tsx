/**
 * Server component - the signed-in dashboard's performance overview.
 *
 * Renders nothing (returns null) when the user is not signed in, so
 * the dashboard degrades to the static tool cards + "does/doesn't do"
 * panel that already exist.
 *
 * Data comes straight from the Prisma-backed fetchUserTrades helper
 * (scoped to the authenticated user) - not through /api/trades, which
 * would be a redundant HTTP round-trip from a Server Component.
 *
 * Everything here is server-rendered: the equity sparkline is a plain
 * inline SVG (no recharts bundle) and the stats are computed with the
 * pure helpers in src/lib/trades/schema.ts. Zero client JS added.
 */
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Minus,
  Plus,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import { getUserOrNull } from "@/lib/auth";
import { fetchUserTrades } from "@/lib/trades/queries";
import {
  computeStats,
  equityCurve,
  formatMoney,
  formatPct,
  formatRatio,
  type TradeRow,
} from "@/lib/trades/schema";

export async function DashboardStats() {
  // No signed-in user -> hide the section entirely.
  const user = await getUserOrNull();
  if (!user) return null;

  // Up to 200 trades: 5 power the recent-trades table, the full set
  // drives the KPI row + equity curve. fetchUserTrades calls
  // getUserOrThrow internally, so gate on getUserOrNull first.
  let trades: TradeRow[] = [];
  try {
    trades = await fetchUserTrades({ limit: 200 });
  } catch (err) {
    // Query failure (e.g. schema not pushed yet) hides the section
    // instead of crashing the dashboard.
    console.warn("[dashboard] stats query failed:", err);
    return null;
  }

  if (trades.length === 0) {
    return <EmptyJournalCTA />;
  }

  const recent = trades.slice(0, 6);
  const stats = computeStats(trades);
  const curve = equityCurve(trades);

  // Expectancy: average R-multiple across trades that have one.
  const rValues = trades
    .map((t) => t.r_multiple)
    .filter((r): r is number => r != null && Number.isFinite(r));
  const avgR = rValues.length > 0 ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null;

  // Reward/risk from average winner vs average loser (per-trade ratio,
  // more intuitive than profit factor when the sample is small).
  const rrRatio =
    stats.avgLoss < 0 && stats.avgWin > 0 ? stats.avgWin / Math.abs(stats.avgLoss) : null;

  return (
    <section aria-label="Performance overview" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Performance overview
        </h2>
        <Link
          href="/journal"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Open journal
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Net P&L"
          value={formatMoney(stats.netPnl)}
          sub={`${stats.closed} closed · ${stats.total - stats.closed} open`}
          tone={stats.netPnl === 0 ? "neutral" : stats.netPnl > 0 ? "positive" : "negative"}
          icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <KpiCard
          label="Win rate"
          value={formatPct(stats.winRate, 0)}
          sub={`${stats.winners}W · ${stats.losers}L`}
          tone={stats.winRate >= 0.5 ? "positive" : "neutral"}
          icon={<Target className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <KpiCard
          label="Profit factor"
          value={Number.isFinite(stats.profitFactor) ? formatRatio(stats.profitFactor) : "—"}
          sub={`${stats.winners + stats.losers > 0 ? formatPct(stats.winRate, 0) + " of trades" : "no closed trades"}`}
          tone={Number.isFinite(stats.profitFactor) && stats.profitFactor >= 1 ? "positive" : "neutral"}
          icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <KpiCard
          label="Expectancy (avg R)"
          value={avgR != null ? `${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R` : "—"}
          sub={`${rValues.length} trades with R`}
          tone={avgR != null ? (avgR > 0 ? "positive" : "negative") : "neutral"}
          icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <KpiCard
          label="Reward : risk"
          value={rrRatio != null ? `${rrRatio.toFixed(2)} : 1` : "—"}
          sub={
            rrRatio != null
              ? `avg win ${formatMoney(stats.avgWin)} · avg loss ${formatMoney(stats.avgLoss)}`
              : "needs wins + losses"
          }
          tone={rrRatio != null ? (rrRatio >= 1 ? "positive" : "negative") : "neutral"}
          icon={<TrendingDown className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />}
        />
        <KpiCard
          label="Plan discipline"
          value={`${stats.total - stats.brokePlanCount}/${stats.total}`}
          sub={
            stats.brokePlanCount === 0
              ? "all followed plan"
              : `${stats.brokePlanCount} broke plan`
          }
          tone={stats.brokePlanCount === 0 ? "positive" : stats.brokePlanCount / stats.total > 0.3 ? "negative" : "neutral"}
          icon={<BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
        />
      </div>

      {/* Equity curve + recent trades side by side on xl */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
        <EquityCard curve={curve} />
        <RecentTradesCard trades={recent} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "positive" | "negative" | "neutral";
  icon: React.ReactNode;
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-500"
      : tone === "negative"
        ? "text-rose-500"
        : "text-foreground";
  return (
    <div className="card-surface p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1.5 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={sub}>
        {sub}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Equity sparkline (pure SVG, server-rendered - no client JS)
// ---------------------------------------------------------------------------

function EquityCard({ curve }: { curve: { at: string; equity: number }[] }) {
  const W = 320;
  const H = 72;
  const PAD = 4;
  const last = curve[curve.length - 1]?.equity ?? 0;
  const max = Math.max(...curve.map((p) => p.equity), last, 0);
  const min = Math.min(...curve.map((p) => p.equity), last, 0);
  const range = max - min || 1;

  const pts = curve.map((p, i) => {
    const x = PAD + (i / Math.max(curve.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.equity - min) / range) * (H - PAD * 2);
    return [x, y] as const;
  });

  const zeroY = H - PAD - ((0 - min) / range) * (H - PAD * 2);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${(W - PAD).toFixed(1)},${zeroY.toFixed(1)} L${PAD},${zeroY.toFixed(1)} Z`;
  const positive = last >= 0;
  const stroke = positive ? "rgb(16 185 129)" : "rgb(244 63 94)";

  // Simple max drawdown: biggest peak-to-trough dip in realized equity.
  let peak = curve[0]?.equity ?? 0;
  let maxDD = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    maxDD = Math.min(maxDD, p.equity - peak);
  }

  return (
    <div className="card-surface p-4 xl:col-span-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Equity curve
        </h3>
        <span className={`text-sm font-semibold tabular-nums ${positive ? "text-emerald-500" : "text-rose-500"}`}>
          {formatMoney(last)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-3 h-16 w-full"
        role="img"
        aria-label={`Equity curve, current net P&L ${formatMoney(last)}, max drawdown ${formatMoney(maxDD)}`}
      >
        <line
          x1={PAD}
          x2={W - PAD}
          y1={zeroY}
          y2={zeroY}
          stroke="currentColor"
          strokeDasharray="3 4"
          className="text-border"
          strokeWidth="1"
        />
        <path d={area} fill={stroke} opacity="0.12" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {curve.length - 1} closed trade{curve.length - 1 === 1 ? "" : "s"}
        </span>
        <span>
          Max DD <span className="tabular-nums text-foreground/80">{formatMoney(maxDD)}</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent trades table
// ---------------------------------------------------------------------------

function RecentTradesCard({ trades }: { trades: TradeRow[] }) {
  return (
    <div className="card-surface p-4 xl:col-span-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recent trades
        </h3>
        <Link href="/journal" className="text-[11px] text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      <table className="mt-3 w-full text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
            <th className="pb-1.5 font-medium">Pair</th>
            <th className="pb-1.5 font-medium">Side</th>
            <th className="pb-1.5 text-right font-medium">Lots</th>
            <th className="pb-1.5 text-right font-medium">R</th>
            <th className="pb-1.5 text-right font-medium">P&L</th>
            <th className="pb-1.5 text-right font-medium">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {trades.map((t) => {
            const date = t.closed_at ?? t.opened_at;
            return (
              <tr key={t.id} className="align-middle">
                <td className="py-1.5 font-medium tabular-nums">
                  {t.pair.slice(0, 3)}/{t.pair.slice(3)}
                </td>
                <td className="py-1.5">
                  <span
                    className={
                      t.direction === "buy"
                        ? "inline-flex items-center gap-0.5 font-mono text-[10px] font-medium text-emerald-500"
                        : "inline-flex items-center gap-0.5 font-mono text-[10px] font-medium text-rose-500"
                    }
                  >
                    {t.direction === "buy" ? (
                      <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                    ) : (
                      <Minus className="h-2.5 w-2.5" aria-hidden="true" />
                    )}
                    {t.direction.toUpperCase()}
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{t.lot_size.toFixed(2)}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {t.r_multiple != null ? `${t.r_multiple > 0 ? "+" : ""}${t.r_multiple.toFixed(2)}` : "—"}
                </td>
                <td
                  className={`py-1.5 text-right font-medium tabular-nums ${
                    t.pnl == null
                      ? "text-muted-foreground"
                      : t.pnl > 0
                        ? "text-emerald-500"
                        : "text-rose-500"
                  }`}
                >
                  {formatMoney(t.pnl)}
                </td>
                <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                  {date ? format(new Date(date), "MMM d") : "—"}
                  {!t.closed_at && <span className="ml-1 text-[9px] text-amber-500">open</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyJournalCTA() {
  return (
    <section aria-label="Your journal at a glance" className="mt-8">
      <div className="card-surface border-dashed p-6">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-semibold">Start your trade journal</h2>
            <p className="mt-1 text-xs text-muted-foreground max-w-md">
              Log your first trade to see win rate, profit factor, expectancy
              and your equity curve here on the dashboard.
            </p>
          </div>
          <Link
            href="/journal"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Open journal
          </Link>
        </div>
      </div>
    </section>
  );
}
