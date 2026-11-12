/**
 * Server component - renders a small "Today in your journal" panel
 * for signed-in users. Renders nothing (returns null) when the user
 * is not signed in, so the dashboard degrades to the static tool cards
 * + "does/doesn't do" panel that already exists.
 *
 * Stats are pulled directly from the Prisma-backed fetchUserTrades
 * helper (which scopes by the authenticated user). We don't go through
 * /api/trades because that would be a redundant HTTP round-trip from a
 * Server Component.
 */
import Link from "next/link";
import { TrendingUp, TrendingDown, Activity, BookOpen, ArrowRight } from "lucide-react";
import { getUserOrNull } from "@/lib/auth";
import { fetchUserTrades } from "@/lib/trades/queries";
import { computeStats, formatMoney, formatPct, formatRatio, type TradeRow } from "@/lib/trades/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export async function DashboardStats() {
  // No signed-in user -> hide the section (the rest of the dashboard is
  // still useful to anonymous visitors).
  const user = await getUserOrNull();
  if (!user) return null;

  // Pull up to 100 of the user's most-recent trades. The first 5 power
  // the "recent trades" list; the full set drives the summary stats.
  // fetchUserTrades calls getUserOrThrow internally, so we gate on
  // getUserOrNull above first to avoid a thrown UnauthorizedError.
  let trades: TradeRow[] = [];
  try {
    trades = await fetchUserTrades({ limit: 100 });
  } catch (err) {
    // If the query fails (e.g. table not migrated yet), hide the
    // section instead of crashing the dashboard.
    console.warn("[dashboard] stats query failed:", err);
    return null;
  }

  if (trades.length === 0) {
    // Empty journal - show a friendly CTA to add a trade.
    return <EmptyJournalCTA />;
  }

  const recent = trades.slice(0, 5);
  const stats = computeStats(trades);
  const netPositive = stats.netPnl > 0;

  return (
    <section aria-label="Your journal at a glance" className="mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Your journal at a glance
        </h2>
        <Link
          href="/journal"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Open journal
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      {/* Stat cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Net PnL"
          value={formatMoney(stats.netPnl)}
          sub={`${stats.closed} closed · ${stats.total - stats.closed} open`}
          tone={stats.netPnl === 0 ? "neutral" : netPositive ? "positive" : "negative"}
          icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <StatCard
          label="Win rate"
          value={formatPct(stats.winRate)}
          sub={`${stats.winners}W · ${stats.losers}L`}
          tone="neutral"
          icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <StatCard
          label="Profit factor"
          value={Number.isFinite(stats.profitFactor) ? formatRatio(stats.profitFactor) : "—"}
          sub={`GP ${formatMoney(stats.grossProfit)}`}
          tone={Number.isFinite(stats.profitFactor) && stats.profitFactor >= 1 ? "positive" : "neutral"}
          icon={<TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <StatCard
          label="Plan discipline"
          value={`${stats.total - stats.brokePlanCount}/${stats.total}`}
          sub="followed plan"
          tone={stats.brokePlanCount === 0 ? "positive" : stats.brokePlanCount / stats.total > 0.3 ? "negative" : "neutral"}
          icon={<BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
        />
      </div>

      {/* Recent trades list */}
      {recent.length > 0 && (
        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Recent trades
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <ul className="divide-y divide-border/60">
              {recent.map((t) => (
                <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="outline"
                      className={
                        t.direction === "buy"
                          ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10 font-mono"
                          : "border-rose-500/40 text-rose-500 bg-rose-500/10 font-mono"
                      }
                    >
                      {t.direction === "buy" ? "BUY" : "SELL"}
                    </Badge>
                    <span className="text-sm font-medium truncate">
                      {t.pair.slice(0, 3)}/{t.pair.slice(3)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t.lot_size.toFixed(2)} lots
                    </span>
                  </div>
                  <div className="text-right">
                    <div
                      className={
                        t.pnl != null
                          ? t.pnl > 0
                            ? "text-sm font-medium text-emerald-500 tabular-nums"
                            : "text-sm font-medium text-rose-500 tabular-nums"
                          : "text-sm font-medium text-muted-foreground"
                      }
                    >
                      {formatMoney(t.pnl)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t.closed_at ? "closed" : "open"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function StatCard({
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
  const toneClass =
    tone === "positive"
      ? "text-emerald-500"
      : tone === "negative"
        ? "text-rose-500"
        : "text-foreground";
  return (
    <Card className="bg-card/60">
      <CardContent className="py-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>
          {value}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function EmptyJournalCTA() {
  return (
    <section aria-label="Your journal at a glance" className="mt-8">
      <Card className="border-dashed bg-card/50">
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-5">
          <div>
            <h2 className="text-sm font-semibold">Start your trade journal</h2>
            <p className="mt-1 text-xs text-muted-foreground max-w-md">
              Log your first trade to see win rate, profit factor and plan-
              discipline stats here on the dashboard.
            </p>
          </div>
          <Link
            href="/journal"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Open journal
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
