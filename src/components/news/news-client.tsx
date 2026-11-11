"use client";

/**
 * Market News - main interactive surface.
 *
 * Layout:
 *  - PageHeader with last-updated time + Refresh button.
 *  - Watchlist filter (chips for USD/EUR/GBP/JPY/AUD/CAD/CHF/NZD/XAU).
 *    Multi-select; the headlines list and the brief both respect it.
 *  - AI Market Brief panel (collapses to a CTA when no brief yet).
 *  - Headlines list (cards), each with source, time-ago, related
 *    ccy badges, headline, summary, and an external link.
 *
 * State:
 *  - Headlines come from GET /api/news (cached 5 min server-side).
 *  - Watchlist is local state (no persistence yet; Phase X+ can use
 *    Supabase user preferences).
 *
 * Notes:
 *  - The "Generate brief" button sends headlines + watchlist to
 *    POST /api/news/brief (which requires auth).
 *  - The brief panel only renders when there's at least 1 headline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Newspaper, RefreshCw, Loader2, AlertTriangle, ExternalLink, Filter } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarketBrief } from "@/components/news/market-brief";
import {
  matchesWatchlist,
  timeAgo,
  truncate,
  type NewsItem,
  type NewsResponse,
} from "@/lib/news/schema";
import { cn } from "@/lib/utils";

const WATCHLIST_CCYS = [
  "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "XAU",
] as const;

const PROVIDER_LABEL: Record<NewsResponse["provider"], string> = {
  finnhub: "Finnhub",
  twelvedata: "Twelve Data",
  sample: "Sample data",
};

export function NewsClient() {
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<NewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);

  const load = useCallback(async (force: boolean) => {
    setError(null);
    setRefreshing(true);
    try {
      const url = force ? "/api/news?force=1" : "/api/news";
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (HTTP ${res.status})`);
      }
      const json: NewsResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load news.",
      );
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.items.filter((item) =>
      matchesWatchlist(item, watchlist),
    );
  }, [data, watchlist]);

  const toggleCcy = (ccy: string) => {
    setWatchlist((prev) =>
      prev.includes(ccy) ? prev.filter((c) => c !== ccy) : [...prev, ccy],
    );
  };

  const clearWatchlist = () => setWatchlist([]);

  return (
    <>
      <PageHeader
        title="Market News"
        description="Forex headlines and an AI market brief that summarizes drivers and risks. Advisory only - never financial advice."
        icon={<Newspaper className="h-5 w-5" />}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={refreshing}
            aria-label="Refresh headlines"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline ml-1">Refresh</span>
          </Button>
        }
      />

      {/* Provider + last-fetched info bar */}
      {data && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant="outline"
            className={cn(
              "font-mono",
              data.provider === "sample"
                ? "border-amber-500/40 text-amber-400"
                : "border-emerald-500/40 text-emerald-400",
            )}
          >
            {PROVIDER_LABEL[data.provider]}
            {data.cached && " · cached"}
          </Badge>
          <span>Updated {timeAgo(data.fetched_at)}</span>
          {data.note && (
            <span className="text-amber-400/90">{data.note}</span>
          )}
        </div>
      )}

      {/* Load error */}
      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Watchlist filter */}
      {loaded && data && data.items.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Filter className="h-3 w-3" aria-hidden="true" />
            Watchlist:
          </span>
          {WATCHLIST_CCYS.map((ccy) => {
            const active = watchlist.includes(ccy);
            return (
              <button
                key={ccy}
                type="button"
                onClick={() => toggleCcy(ccy)}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {ccy}
              </button>
            );
          })}
          {watchlist.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={clearWatchlist}
            >
              Clear
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} of {data.items.length} headlines
          </span>
        </div>
      )}

      {/* Loading state */}
      {!loaded && (
        <div className="mt-12 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
          Loading headlines...
        </div>
      )}

      {/* AI Brief */}
      {loaded && data && filtered.length > 0 && (
        <div className="mt-6">
          <MarketBrief headlines={filtered} watchlist={watchlist} />
        </div>
      )}

      {/* Headlines list */}
      {loaded && data && (
        <div className="mt-6 space-y-3">
          {filtered.length === 0 ? (
            <Card className="border-dashed bg-card/50">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No headlines match your watchlist. Try clearing the filter.
              </CardContent>
            </Card>
          ) : (
            filtered.map((item) => <HeadlineCard key={item.id} item={item} />)
          )}
        </div>
      )}

      {/* Disclaimer (always) */}
      <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">
        Not financial advice. Trading forex involves substantial risk of loss.
        ForexMind never places trades and never predicts prices.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Headline card
// ---------------------------------------------------------------------------

function HeadlineCard({ item }: { item: NewsItem }) {
  return (
    <Card className="bg-card/60 hover:bg-card transition-colors">
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-1.5">
              <Badge variant="secondary" className="font-mono text-[10px] py-0">
                {item.source}
              </Badge>
              <span title={item.published_at}>{timeAgo(item.published_at)}</span>
              {item.related.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.related.slice(0, 4).map((c) => (
                    <span
                      key={c}
                      className="rounded-sm border border-border/60 px-1 py-0 text-[10px] font-mono text-muted-foreground"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Headline */}
            <h3 className="text-sm font-semibold leading-snug mb-1">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline underline-offset-2 inline-flex items-start gap-1"
              >
                <span>{item.headline}</span>
                <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 opacity-60" aria-hidden="true" />
              </a>
            </h3>

            {/* Summary */}
            {item.summary && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {truncate(item.summary, 200)}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
