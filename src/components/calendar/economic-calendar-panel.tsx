"use client";

/**
 * Economic Calendar panel.
 *
 * Fetches /api/calendar on mount (5-min server cache) and renders a
 * timeline of upcoming high-impact + medium-impact economic events.
 *
 * Key features:
 *  - "Don't trade now" banner when the current time falls within a
 *    high-impact event's no-trade window (15 min before/after).
 *  - Impact-level coloring (red high, amber medium, grey low).
 *  - Forecast / previous / actual values shown when available.
 *  - Currency badge so the user can spot USD vs EUR vs GBP events.
 *  - Relative time ("in 2h", "in 3d") so the user knows how soon.
 *  - Clicking a currency filters the news watchlist... actually no,
 *    the panel is self-contained on the news page.
 *
 * Sample data is used in the sandbox (no provider key needed). The
 * panel honestly labels it as "Sample data" with an amber badge.
 */
import { useEffect, useState } from "react";
import { Calendar, Loader2, RefreshCw, AlertTriangle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  impactMeta,
  isInNoTradeWindow,
  nextHighImpactEvent,
  formatEventTime,
  timeUntil,
  type CalendarResponse,
  type EconomicEvent,
} from "@/lib/calendar/schema";
import { cn } from "@/lib/utils";

export function EconomicCalendarPanel() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (force: boolean) => {
    setRefreshing(true);
    try {
      const url = force ? "/api/calendar?force=1" : "/api/calendar";
      const res = await fetch(url);
      if (!res.ok) return;
      const json: CalendarResponse = await res.json();
      setData(json);
    } catch {
      // Keep stale data if we have it.
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
      <Card className="bg-card/60">
        <CardContent className="py-8 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
          Loading economic calendar...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.events.length === 0) {
    return null;
  }

  const now = Date.now();
  const nextHigh = nextHighImpactEvent(data.events, now);
  const inNoTrade = data.events.some((e) => isInNoTradeWindow(e, now));

  // Group events by date for the timeline.
  const grouped = groupByDate(data.events);

  return (
    <Card className="bg-card/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-base">Economic Calendar</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {data.has_live ? (
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">
                live
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
                sample data
              </Badge>
            )}
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Refresh calendar"
              title="Refresh calendar"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          High-impact events can move markets 50+ pips. Consider staying flat 15 min before/after.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* "Don't trade now" banner */}
        {inNoTrade && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">High-impact event in progress</p>
              <p className="text-xs opacity-90 mt-0.5">
                A high-impact economic release is happening right now. Spreads
                typically widen and volatility spikes. Consider waiting 15
                minutes for the dust to settle.
              </p>
            </div>
          </div>
        )}

        {/* Next high-impact event highlight */}
        {nextHigh && !inNoTrade && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
              <span className="text-muted-foreground">Next high-impact:</span>
              <span className="font-medium">{nextHigh.title}</span>
              <Badge variant="outline" className="text-[10px] font-mono py-0">
                {nextHigh.currency}
              </Badge>
              <span className="ml-auto text-amber-500 font-medium">
                {timeUntil(nextHigh.time, now)}
              </span>
            </div>
          </div>
        )}

        {/* Event timeline grouped by date */}
        <div className="space-y-3">
          {grouped.map((group) => (
            <div key={group.dateLabel}>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5 sticky top-0 bg-card/80 backdrop-blur-sm py-0.5">
                {group.dateLabel}
              </div>
              <ul className="space-y-1.5">
                {group.events.map((e) => (
                  <EventRow key={e.id} event={e} now={now} />
                ))}
              </ul>
            </div>
          ))}
        </div>

        {data.note && (
          <p className="text-[10px] text-muted-foreground">
            {data.note}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({ event, now }: { event: EconomicEvent; now: number }) {
  const meta = impactMeta(event.impact);
  const isPast = Date.parse(event.time) < now;
  const inWindow = isInNoTradeWindow(event, now);

  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
        meta.color === "rose"
          ? "border-rose-500/30 bg-rose-500/5"
          : meta.color === "amber"
            ? "border-amber-500/20 bg-amber-500/5"
            : "border-border bg-muted/20",
        isPast && "opacity-50",
        inWindow && "ring-1 ring-rose-500/50",
      )}
    >
      {/* Impact dot */}
      <span
        className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)}
        aria-label={`${meta.label} impact`}
        title={`${meta.label} impact`}
      />

      {/* Time */}
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0 w-16">
        {formatEventTime(event.time).split(" ")[0]}{" "}
        {formatEventTime(event.time).match(/\d{2}:\d{2}/)?.[0] ?? ""}
      </span>

      {/* Currency badge */}
      <Badge
        variant="outline"
        className="text-[9px] font-mono py-0 px-1 shrink-0"
      >
        {event.currency}
      </Badge>

      {/* Title */}
      <span className={cn("font-medium truncate flex-1", isPast && "line-through")}>
        {event.title}
      </span>

      {/* Values: forecast / previous / actual */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums shrink-0">
        {event.actual ? (
          <span className="text-foreground font-medium">
            {event.actual}
          </span>
        ) : (
          <>
            {event.forecast && (
              <span title="Forecast">F: {event.forecast}</span>
            )}
            {event.previous && (
              <span title="Previous">P: {event.previous}</span>
            )}
          </>
        )}
      </div>

      {/* Relative time */}
      <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">
        {timeUntil(event.time, now)}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DateGroup = {
  dateLabel: string;
  events: EconomicEvent[];
};

function groupByDate(events: EconomicEvent[]): DateGroup[] {
  const groups = new Map<string, EconomicEvent[]>();
  for (const e of events) {
    const d = new Date(e.time);
    const key = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    });
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  return Array.from(groups.entries()).map(([dateLabel, evs]) => ({
    dateLabel,
    events: evs,
  }));
}
