"use client";

/**
 * Live FX rate widget - terminal-style ticker strip.
 *
 * Fetches /api/prices (5-min server cache) and renders the supported
 * pairs as a TradingView-like strip: currency flag, pair, rate with
 * emphasized pip digits, and a change badge vs. the first rate seen
 * today (stored in sessionStorage - the upstream API has no history).
 * Clicking a pair opens the risk calculator with it pre-selected.
 *
 *  - Auto-refreshes silently every 60s (server serves cached data,
 *    and each poll also drives the alert sweep server-side).
 *  - Rate display follows pip conventions: big figures muted, pips +
 *    pipette emphasized, JPY pairs 3 decimals, others 5.
 *  - Edge fades + hidden scrollbar for a clean strip look.
 */
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type PriceResponse,
  type PriceQuote,
} from "@/lib/prices/schema";
import {
  baselineQuotes,
  ChangeBadge,
  PairLabel,
  RateDigits,
} from "@/components/prices/rate-display";

/** Poll interval for silent refreshes (server cache TTL is 5 min). */
const SILENT_REFRESH_MS = 60_000;

/** "19:36" from an ISO timestamp, in the viewer's local time. */
function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function PriceTicker({ className }: { className?: string }) {
  const [data, setData] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Tick to re-render "as of" clock + recompute changes after refresh. */
  const [, setTick] = useState(0);
  const mounted = useRef(true);

  const load = async (force: boolean, silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const url = force ? "/api/prices?force=1" : "/api/prices";
      const res = await fetch(url);
      if (res.ok && mounted.current) {
        const json: PriceResponse = await res.json();
        // Baseline the first rate seen per pair today (once), so the
        // change badge shows the move since the session started.
        baselineQuotes(json.quotes);
        setData(json);
        setTick((t) => t + 1);
      }
    } catch {
      // Network error - keep stale data if we have it.
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load(false);
    const id = setInterval(() => void load(false, true), SILENT_REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  if (loading && !data) {
    return (
      <div
        className={cn(
          "flex h-[104px] items-center gap-2 rounded-xl border border-border bg-card/60 px-4 text-xs text-muted-foreground",
          className,
        )}
        aria-label="Loading live prices"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Loading live prices...
      </div>
    );
  }

  if (!data || data.quotes.length === 0) {
    return null; // Don't render anything if prices are unavailable.
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
      role="region"
      aria-label="Live FX prices"
    >
      {/* Header: title + freshness + last-updated clock + refresh */}
      <div className="flex items-center gap-2.5 border-b border-border/70 bg-gradient-to-r from-primary/[0.04] to-transparent px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
          Live FX rates
        </span>
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
            data.cached
              ? "bg-muted text-muted-foreground"
              : "bg-emerald-500/10 text-emerald-500",
          )}
          title={data.cached ? "Served from a 5-minute cache" : "Fresh from the rates API"}
        >
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              data.cached ? "bg-muted-foreground/70" : "bg-emerald-500 animate-pulse",
            )}
            aria-hidden="true"
          />
          {data.cached ? "cached" : "live"}
        </span>
        <span
          className="text-[10px] tabular-nums text-muted-foreground"
          title="Time the rates were fetched"
        >
          as of {formatClock(data.fetched_at)}
        </span>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Refresh prices"
          title="Refresh prices"
        >
          <RefreshCw
            className={cn("h-3 w-3", refreshing && "animate-spin")}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      {/* Strip: pairs with edge fades */}
      <div className="relative">
        <div
          className={cn(
            "flex items-stretch divide-x divide-border/50 overflow-x-auto",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {data.quotes.map((q) => (
            <TickerItem key={q.pair} quote={q} />
          ))}
        </div>
        {/* Edge fades (hide the clipped first/last item) */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card to-transparent"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function TickerItem({ quote }: { quote: PriceQuote }) {
  return (
    <a
      href={`/risk-calculator?pair=${quote.pair}`}
      className={cn(
        "group flex shrink-0 items-center gap-2 px-3.5 py-2.5 transition-colors",
        "hover:bg-accent/60",
        quote.stale && "opacity-50",
      )}
      title={`${quote.pair} — click to open in the risk calculator`}
    >
      <PairLabel pair={quote.pair} />
      <RateDigits pair={quote.pair} rate={quote.rate} />
      <ChangeBadge quote={quote} />
    </a>
  );
}
