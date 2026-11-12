"use client";

/**
 * Economic Calendar - main interactive surface.
 *
 * Fetches /api/calendar?days=14 on mount, then renders:
 *  - A callout with the next high-impact event + a "don't trade" warning
 *    if any event is currently inside its no-trade window.
 *  - A filter bar (impact / currency / no-trade-only).
 *  - Events grouped by date, color-coded by impact.
 *
 * The calendar is advisory only: we never tell the user to trade or
 * not trade around an event. We surface the timing + impact and let
 * them decide.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, AlertTriangle, RefreshCw, Info } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  filterEvents,
  groupByDate,
  formatDateKey,
  formatEventTime,
  timeUntil,
  impactMeta,
  isInNoTradeWindow,
  nextHighImpactEvent,
  EMPTY_CALENDAR_FILTER,
  type CalendarFilter,
  type CalendarResponse,
} from "@/lib/calendar/schema";

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF"] as const;

export function CalendarClient() {
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CalendarFilter>(EMPTY_CALENDAR_FILTER);

  const load = useCallback(async (force = false) => {
    setError(null);
    setLoaded(false);
    try {
      const url = `/api/calendar?days=14${force ? "&force=1" : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json: CalendarResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const now = Date.now();
  const allEvents = data?.events ?? [];
  const filtered = useMemo(
    () => filterEvents(allEvents, filter, now),
    [allEvents, filter, now],
  );
  const groups = useMemo(() => groupByDate(filtered), [filtered]);
  const next = useMemo(() => nextHighImpactEvent(allEvents, now), [allEvents, now]);
  const inWindowNow = useMemo(
    () => allEvents.filter((e) => isInNoTradeWindow(e, now)),
    [allEvents, now],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Economic Calendar"
        description="Scheduled releases that can move forex markets. The timing + impact is shown for your awareness; the decision to trade around an event is always yours."
        icon={<CalendarClock className="h-5 w-5" />}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={!loaded}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {/* No-trade window callout */}
      {inWindowNow.length > 0 && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-rose-500">
                Active no-trade window
              </p>
              <p className="text-muted-foreground">
                {inWindowNow.map((e) => e.title).join(", ")} is releasing right now.
                Spreads typically widen and price action gets erratic within
                ~15 minutes of a high-impact event. This is informational, not a
                recommendation.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Next high-impact event */}
      {next && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-4">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-amber-500">
                Next high-impact: {next.title} ({next.currency})
              </p>
              <p className="text-muted-foreground">
                {formatEventTime(next.time)} - {timeUntil(next.time, now)}.
                Forecast: {next.forecast ?? "n/a"} - Previous: {next.previous ?? "n/a"}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sample data notice */}
      {data?.note && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <Info className="h-3.5 w-3.5" />
          {data.note}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Filter:</span>
        <Select
          value={filter.impact}
          onValueChange={(v) =>
            setFilter((f) => ({ ...f, impact: v as CalendarFilter["impact"] }))
          }
        >
          <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Filter by impact">
            <SelectValue placeholder="All impacts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All impacts</SelectItem>
            <SelectItem value="high">High only</SelectItem>
            <SelectItem value="medium">Medium+</SelectItem>
            <SelectItem value="low">All (incl. low)</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filter.currency}
          onValueChange={(v) => setFilter((f) => ({ ...f, currency: v }))}
        >
          <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="Filter by currency">
            <SelectValue placeholder="All currencies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All currencies</SelectItem>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={filter.noTradeOnly}
            onCheckedChange={(v) =>
              setFilter((f) => ({ ...f, noTradeOnly: v === true }))
            }
          />
          In no-trade window only
        </label>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {allEvents.length} events
        </span>
      </div>

      {/* Loading / error / empty / list */}
      {!loaded ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading calendar...
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No events match the current filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.date} className="space-y-2">
              <div className="sticky top-0 z-10 -mx-1 bg-background/80 px-1 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                {formatDateKey(g.date)}
              </div>
              {g.events.map((e) => {
                const meta = impactMeta(e.impact);
                const inWindow = isInNoTradeWindow(e, now);
                return (
                  <Card
                    key={e.id}
                    className={inWindow ? "border-rose-500/40 bg-rose-500/5" : undefined}
                  >
                    <CardContent className="flex items-start gap-3 py-3">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                        aria-label={`${meta.label} impact`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{e.title}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {e.currency}
                          </Badge>
                          {e.impact === "high" && (
                            <Badge className="bg-rose-600 text-[10px] text-white">
                              High
                            </Badge>
                          )}
                          {e.impact === "medium" && (
                            <Badge className="bg-amber-500 text-[10px] text-black">
                              Medium
                            </Badge>
                          )}
                          {inWindow && (
                            <Badge className="bg-rose-600 animate-pulse text-[10px] text-white">
                              Live
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatEventTime(e.time)} - {timeUntil(e.time, now)}
                        </div>
                        {(e.forecast || e.previous || e.actual) && (
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-xs">
                            {e.actual && (
                              <span>
                                <span className="text-muted-foreground">Actual:</span>{" "}
                                <span className="font-medium text-foreground">
                                  {e.actual}
                                </span>
                              </span>
                            )}
                            {e.forecast && (
                              <span>
                                <span className="text-muted-foreground">Forecast:</span>{" "}
                                {e.forecast}
                              </span>
                            )}
                            {e.previous && (
                              <span>
                                <span className="text-muted-foreground">Previous:</span>{" "}
                                {e.previous}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Advisory only. ForexMind never tells you to trade or not trade around an
        event. The decision is always yours.
      </p>
    </div>
  );
}
