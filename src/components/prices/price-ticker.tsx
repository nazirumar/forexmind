"use client";

/**
 * Live FX price ticker strip.
 *
 * Fetches /api/prices on mount (5-min server cache) and renders a
 * horizontal scrolling strip of the 15 supported pairs with live
 * rates. Clicking a pair navigates to the risk calculator with that
 * pair pre-selected (via URL query param).
 *
 *  - Cached for 5 min server-side, so this is cheap.
 *  - Falls back to "—" for any pair we couldn't fetch.
 *  - No live updates (no websocket) - the user can refresh to get
 *    fresh rates. Real-time streaming is a future enhancement.
 *  - "Live" badge pulses green to indicate the data is fresh.
 */
import { useEffect, useState } from "react";
import { TrendingUp, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRate, type PriceResponse, type PriceQuote } from "@/lib/prices/schema";

export function PriceTicker({ className }: { className?: string }) {
  const [data, setData] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (force: boolean) => {
    setRefreshing(true);
    try {
      const url = force ? "/api/prices?force=1" : "/api/prices";
      const res = await fetch(url);
      if (!res.ok) return;
      const json: PriceResponse = await res.json();
      setData(json);
    } catch {
      // Network error - keep stale data if we have it.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  if (loading && !data) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-xs text-muted-foreground py-2",
          className,
        )}
        aria-label="Loading live prices"
      >
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
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
        "flex items-center gap-2 overflow-x-auto py-2 text-xs",
        className,
      )}
      role="region"
      aria-label="Live FX prices"
    >
      <span
        className={cn(
          "flex items-center gap-1 shrink-0 font-medium",
          data.cached ? "text-muted-foreground" : "text-emerald-500",
        )}
        title={data.cached ? "Cached (5 min)" : "Fresh from API"}
      >
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            data.cached ? "bg-muted-foreground" : "bg-emerald-500 animate-pulse",
          )}
          aria-hidden="true"
        />
        {data.cached ? "cached" : "live"}
      </span>
      <span className="text-muted-foreground shrink-0">|</span>
      <div className="flex items-center gap-3 overflow-x-auto">
        {data.quotes.map((q) => (
          <PriceChip key={q.pair} quote={q} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => load(true)}
        disabled={refreshing}
        className="shrink-0 ml-auto text-muted-foreground hover:text-foreground"
        aria-label="Refresh prices"
        title="Refresh prices"
      >
        <RefreshCw
          className={cn("h-3 w-3", refreshing && "animate-spin")}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function PriceChip({ quote }: { quote: PriceQuote }) {
  // JPY pairs get a different color treatment to visually distinguish them.
  const isJpy = quote.pair.endsWith("JPY");
  return (
    <a
      href={`/risk-calculator?pair=${quote.pair}`}
      className={cn(
        "shrink-0 inline-flex items-baseline gap-1 tabular-nums",
        "hover:text-foreground transition-colors",
        quote.stale ? "text-muted-foreground/60" : "text-foreground/80",
      )}
      title={`${quote.pair} - click to open in risk calculator`}
    >
      <span className="font-mono text-[10px] text-muted-foreground">
        {quote.pair.slice(0, 3)}/{quote.pair.slice(3)}
      </span>
      <span className={cn(isJpy ? "text-[11px]" : "text-[11px]")}>
        {formatRate(quote.pair, quote.rate)}
      </span>
    </a>
  );
}
