/**
 * Economic calendar event schema + types.
 *
 * An EconomicEvent is a scheduled economic release or central bank
 * decision that can move forex markets: NFP, CPI, FOMC, ECB, etc.
 *
 * The calendar is organized by date, with each event having:
 *  - time (UTC) + expected impact level
 *  - currency affected (USD, EUR, GBP, etc.)
 *  - actual/forecast/previous values (when available)
 *  - a "don't trade" window (15 min before/after high-impact events)
 */
import { z } from "zod";

export const impactSchema = z.enum(["high", "medium", "low"]);
export type Impact = z.infer<typeof impactSchema>;

export const economicEventSchema = z.object({
  id: z.string(),
  /** ISO timestamp of when the event is scheduled (UTC). */
  time: z.string(),
  /** Event name, e.g. "Non-Farm Payrolls", "FOMC Rate Decision". */
  title: z.string().min(3).max(120),
  /** ISO currency code most affected, e.g. "USD", "EUR". */
  currency: z.string().length(3),
  impact: impactSchema,
  /** Forecast value (string, because formats vary: "3.5%", "200K", "5.25%"). */
  forecast: z.string().optional(),
  /** Previous value. */
  previous: z.string().optional(),
  /** Actual value (filled in after the event). */
  actual: z.string().optional(),
  /** Source/agency, e.g. "BLS", "Fed", "ECB". */
  source: z.string().optional(),
});

export type EconomicEvent = z.infer<typeof economicEventSchema>;

/**
 * Response envelope returned by GET /api/calendar.
 *  - events: array of EconomicEvent, ordered by time ascending
 *  - fetched_at: when the server generated the page
 *  - window_start / window_end: the date range covered
 *  - has_live: whether any events have actual values (vs all forecast-only)
 */
export const calendarResponseSchema = z.object({
  events: z.array(economicEventSchema),
  fetched_at: z.string(),
  /** ISO date of the first event in the response. */
  window_start: z.string(),
  /** ISO date of the last event in the response. */
  window_end: z.string(),
  /** True when the data came from a live provider (vs sample data). */
  has_live: z.boolean(),
  /** Optional note (e.g. "Sample data - configure a provider for live events"). */
  note: z.string().optional(),
});

export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Check whether "now" falls within the "don't trade" window around a
 * high-impact event.
 *
 * Convention: 15 minutes before and 15 minutes after a high-impact
 * event. Medium-impact events have a 5-minute window. Low-impact
 * events have no window.
 *
 * Pure function: takes the event + a timestamp, returns true/false.
 */
export function isInNoTradeWindow(
  event: { time: string; impact: Impact },
  nowMs: number = Date.now(),
): boolean {
  if (event.impact === "low") return false;
  const eventMs = Date.parse(event.time);
  if (Number.isNaN(eventMs)) return false;
  const windowMs = event.impact === "high" ? 15 * 60_000 : 5 * 60_000;
  return nowMs >= eventMs - windowMs && nowMs <= eventMs + windowMs;
}

/**
 * Find the next upcoming high-impact event after "now".
 * Returns null if none in the list.
 *
 * Pure.
 */
export function nextHighImpactEvent(
  events: EconomicEvent[],
  nowMs: number = Date.now(),
): EconomicEvent | null {
  const upcoming = events
    .filter((e) => e.impact === "high" && Date.parse(e.time) > nowMs)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return upcoming[0] ?? null;
}

/** Impact level -> color token + label. */
export function impactMeta(impact: Impact): {
  label: string;
  color: "rose" | "amber" | "slate";
  dot: string;
} {
  switch (impact) {
    case "high":
      return { label: "High", color: "rose", dot: "bg-rose-500" };
    case "medium":
      return { label: "Medium", color: "amber", dot: "bg-amber-500" };
    case "low":
      return { label: "Low", color: "slate", dot: "bg-slate-400" };
  }
}

/** Format an event time for display (UTC, short format). */
export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }) + " UTC";
}

/** Relative time to an event: "in 2h", "in 3d", "started 5m ago". */
export function timeUntil(iso: string, nowMs: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const diff = ms - nowMs;
  if (diff === 0) return "now";
  const isPast = diff < 0;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  if (min < 60) return isPast ? `${min}m ago` : `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return isPast ? `${hr}h ago` : `in ${hr}h`;
  const day = Math.round(hr / 24);
  return isPast ? `${day}d ago` : `in ${day}d`;
}
