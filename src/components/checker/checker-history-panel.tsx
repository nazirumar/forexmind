"use client";

/**
 * Trade Checker History panel.
 *
 * Fetches the user's recent trade-check analyses from
 * GET /api/checker/history and renders them as a list of cards.
 * Each card shows:
 *  - The trade idea that was checked (pair, direction, entry/SL/TP)
 *  - The verdict badge (ok_to_proceed / review / skip)
 *  - The number of high-severity violations
 *  - The summary paragraph
 *  - A "when" timestamp
 *
 * Clicking a card expands it to show the full summary inline. The
 * panel auto-loads on mount; the parent refreshes it after a new
 * check is run so the user sees their latest verdict at the top.
 *
 * Empty state: a friendly "no checks yet" message that points the
 * user to the trade idea form.
 */
import { useCallback, useEffect, useState } from "react";
import { History, Loader2, AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  verdictMeta,
  type RecentCheck,
} from "@/lib/checker/schema";
import { formatPair, timeAgo } from "@/lib/trades/schema";
import { cn } from "@/lib/utils";

const VERDICT_COLOR: Record<
  "emerald" | "amber" | "rose",
  { border: string; bg: string; text: string; chip: string }
> = {
  emerald: {
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/5",
    text: "text-emerald-500",
    chip: "bg-emerald-600 text-white",
  },
  amber: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
    text: "text-amber-500",
    chip: "bg-amber-500 text-black",
  },
  rose: {
    border: "border-rose-500/40",
    bg: "bg-rose-500/5",
    text: "text-rose-500",
    chip: "bg-rose-600 text-white",
  },
};

type Props = {
  /** When this number changes, the panel re-fetches (e.g. after a new
   *  check is run, the parent bumps this to refresh the list). */
  refreshKey: number;
};

export function CheckerHistoryPanel({ refreshKey }: Props) {
  const [checks, setChecks] = useState<RecentCheck[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checker/history?limit=10");
      if (res.status === 401) {
        // Auth required - the parent shows the auth banner already.
        setLoaded(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { checks: RecentCheck[] };
      setChecks(data.checks);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load history.",
      );
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loaded && checks.length === 0 && !error) {
    // Friendly empty state - only show when not signed in is already
    // handled by the parent's auth-required banner.
    return null;
  }

  return (
    <Card className="bg-card/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-base">Recent checks</CardTitle>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={load}
            disabled={loading}
            aria-label="Refresh history"
            className="h-7 text-xs"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="ml-1 hidden sm:inline">Refresh</span>
          </Button>
        </div>
        {checks.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Your last {checks.length} trade-check verdicts. Click a card to expand.
          </p>
        )}
      </CardHeader>

      <CardContent>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {loading && checks.length === 0 && (
          <div className="space-y-2 animate-pulse">
            <div className="h-12 w-full rounded bg-muted/50" />
            <div className="h-12 w-full rounded bg-muted/50" />
          </div>
        )}

        {checks.length > 0 && (
          <ul className="space-y-2">
            {checks.map((c) => {
              const meta = verdictMeta(c.verdict);
              const color = VERDICT_COLOR[meta.color];
              const isExpanded = expandedId === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : c.id)
                    }
                    aria-expanded={isExpanded}
                    className={cn(
                      "w-full text-left rounded-md border p-3 transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      color.border,
                      color.bg,
                      "hover:bg-accent/30",
                    )}
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-mono text-[10px] py-0 shrink-0",
                            c.idea.direction === "buy"
                              ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
                              : "border-rose-500/40 text-rose-500 bg-rose-500/10",
                          )}
                        >
                          {c.idea.direction === "buy" ? "BUY" : "SELL"}
                        </Badge>
                        <span className="text-sm font-medium truncate">
                          {formatPair(c.idea.pair)}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          @{c.idea.entry_price}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            color.chip,
                          )}
                        >
                          {c.verdict.replace(/_/g, " ").toUpperCase()}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        )}
                      </div>
                    </div>

                    {/* Meta row */}
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span title={c.created_at}>{timeAgo(c.created_at)}</span>
                      {c.violations_count > 0 && (
                        <span className="text-rose-500">
                          {c.violations_count} high-severity violation{c.violations_count === 1 ? "" : "s"}
                        </span>
                      )}
                      <span className="tabular-nums">
                        {c.rules_chars > 0 ? `${c.rules_chars} chars of rules` : "no rules"}
                      </span>
                    </div>

                    {/* Expanded summary */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                          Summary
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/90">
                          {c.summary}
                        </p>
                        {c.idea.rationale && (
                          <>
                            <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                              Your rationale
                            </div>
                            <p className="text-xs italic leading-relaxed text-muted-foreground">
                              &ldquo;{c.idea.rationale}&rdquo;
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
