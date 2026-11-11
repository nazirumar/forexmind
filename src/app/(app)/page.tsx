import Link from "next/link";
import { NAV_ITEMS } from "@/lib/nav";
import { PageHeader } from "@/components/layout/page-header";
import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import { TrendingDown, ArrowRight, AlertTriangle } from "lucide-react";

export const metadata = {
  title: "Dashboard - ForexMind",
  description: "AI-assisted forex education, risk management and journaling.",
};

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="AI-assisted forex tools to help you trade more deliberately. Every tool here is advisory only."
        icon={<TrendingDown className="h-5 w-5" />}
      />

      {/* Risk reminder banner */}
      <div
        className="mt-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3"
        role="note"
      >
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"
          aria-hidden="true"
        />
        <p className="text-sm text-amber-200/90">
          Not financial advice. Trading forex involves substantial risk of
          loss. ForexMind never places trades and never predicts prices.
        </p>
      </div>

      {/* Per-user journal snapshot (server component).
          Renders nothing when the user is not signed in (sandbox /
          preview), so the rest of the dashboard still works. */}
      <DashboardStats />

      {/* Tool cards */}
      <section
        aria-label="Tools"
        className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {NAV_ITEMS.filter((item) => item.href !== "/").map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <ArrowRight
                  className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                  aria-hidden="true"
                />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold tracking-tight">
                  {item.label}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </Link>
          );
        })}
      </section>

      {/* What ForexMind does / doesn't do */}
      <section
        aria-label="About ForexMind"
        className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-emerald-400">
            What ForexMind does
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-emerald-400">
                +
              </span>
              <span>
                Explains concepts: pips, lots, leverage, sessions, support /
                resistance, risk-reward, drawdown.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-emerald-400">
                +
              </span>
              <span>
                Computes position size, RR and break-even win rate from your
                numbers.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-emerald-400">
                +
              </span>
              <span>
                Interprets your journal and your own market data to surface
                patterns.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-emerald-400">
                +
              </span>
              <span>Checks trade ideas against rules you define.</span>
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-rose-400">
            What ForexMind does NOT do
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-rose-400">
                -
              </span>
              <span>Predict prices or tell you to buy / sell now.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-rose-400">
                -
              </span>
              <span>Place trades or connect to a broker.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-rose-400">
                -
              </span>
              <span>
                Promise profits. Every answer ends with a risk-management
                reminder.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-rose-400">
                -
              </span>
              <span>
                Invent data. If it doesn&apos;t have enough, it says so.
              </span>
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
