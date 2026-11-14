import Link from "next/link";
import { format } from "date-fns";
import { NAV_ITEMS } from "@/lib/nav";
import { getUserOrNull } from "@/lib/auth";
import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import { PriceTicker } from "@/components/prices/price-ticker";
import {
  TrendingDown,
  ArrowRight,
  AlertTriangle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export const metadata = {
  title: "Dashboard · ForexMind",
  description: "AI-assisted forex education, risk management and journaling.",
};

/** Tools promoted to the featured row (the daily-use workflow). */
const FEATURED = ["/journal", "/risk", "/risk-calculator"] as const;

/** Logical groupings for the full tool grid. */
const GROUPS: { label: string; items: string[] }[] = [
  {
    label: "Plan & analyze",
    items: ["/analytics", "/plan", "/checker", "/chat", "/replay"],
  },
  {
    label: "Market & alerts",
    items: ["/news", "/calendar", "/watchlist"],
  },
  {
    label: "Account",
    items: ["/goals", "/settings"],
  },
];

function navItem(href: string) {
  return NAV_ITEMS.find((i) => i.href === href);
}

export default async function DashboardPage() {
  const user = await getUserOrNull();
  const featured = FEATURED.map(navItem).filter(Boolean) as {
    label: string; href: string; icon: LucideIcon; description: string;
  }[];

  // Time-based greeting (server clock; fine for a dynamic page).
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.displayName?.split(" ")[0] ?? null;
  const headline = firstName ? `${greeting}, ${firstName}.` : "Trade more deliberately.";

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-7 sm:px-8 sm:py-9">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(40rem 20rem at 85% -20%, var(--primary), transparent 70%)",
          }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1">
                <Sparkles className="h-3 w-3 text-primary" aria-hidden="true" />
                AI-assisted · advisory only
              </span>
              <span className="hidden sm:inline tabular-nums">
                {format(new Date(), "EEEE, MMM d")}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[2rem] sm:leading-tight">
              <span className="text-gradient">{headline}</span>
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Journal every trade, size positions from your risk %, track
              R-multiples and live exposure, and check each idea against rules
              you define — all in one place.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              href="/journal"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open journal
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/risk"
              className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              Risk dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* Risk disclaimer — subtle, inline */}
      <div
        className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3.5 py-2.5"
        role="note"
      >
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
          aria-hidden="true"
        />
        <p className="text-xs leading-relaxed text-amber-200/80">
          Not financial advice. Forex trading involves substantial risk of
          loss. ForexMind never places trades, connects to a broker, or
          predicts prices.
        </p>
      </div>

      {/* Journal snapshot (per-user; renders nothing when signed out) */}
      <DashboardStats />      {/* Live FX ticker */}
      <section className="card-surface overflow-hidden">
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Live FX rates
          </h2>
        </div>
        <div className="px-2">
          <PriceTicker />
        </div>
      </section>

      {/* Featured tools */}
      <section aria-label="Featured tools" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Your daily workflow
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {featured.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="card-hover card-surface group flex flex-col gap-4 p-5 hover:border-primary/40"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold tracking-tight">
                    {item.label}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-primary opacity-80 transition-opacity group-hover:opacity-100">
                  Open
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* All tools by group */}
      <section aria-label="All tools" className="space-y-6">
        {GROUPS.map((group) => {
          const items = group.items
            .map(navItem)
            .filter(Boolean) as {
              label: string; href: string; icon: LucideIcon; description: string;
            }[];
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="card-hover card-surface group flex flex-col gap-3 p-4 hover:border-primary/40"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="space-y-0.5">
                        <h3 className="text-sm font-semibold tracking-tight">
                          {item.label}
                        </h3>
                        <p className="text-xs leading-snug text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {/* What ForexMind does / doesn't do */}
      <section
        aria-label="About ForexMind"
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        <div className="card-surface p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
              <TrendingDown className="h-4 w-4 rotate-180" aria-hidden="true" />
            </span>
            <h2 className="text-sm font-semibold">What ForexMind does</h2>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {[
              "Explains concepts: pips, lots, leverage, sessions, support/resistance, risk-reward, drawdown.",
              "Computes position size, RR and break-even win rate from your numbers.",
              "Tracks R-multiples, expectancy, exposure and correlated risk across your journal.",
              "Checks trade ideas against rules you define; reviews your journal for patterns.",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden="true" className="mt-0.5 text-emerald-500">+</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card-surface p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/10 text-rose-500">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2 className="text-sm font-semibold">What ForexMind does NOT do</h2>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {[
              "Predict prices or tell you to buy / sell now.",
              "Place trades or connect to a broker.",
              "Promise profits. Every answer ends with a risk reminder.",
              "Invent data. If it doesn’t have enough, it says so.",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden="true" className="mt-0.5 text-rose-500">−</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
