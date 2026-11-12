/**
 * Economic calendar fetcher with in-memory cache.
 *
 * Currently uses the sample calendar (deterministic, computed from
 * "now"). In production, swap this for a real provider:
 *  - Finnhub premium economic calendar
 *  - Trading Economics API
 *  - ForexFactory scraping (fragile, not recommended)
 *
 * Cache: 5 minutes. The calendar doesn't change that fast, and the
 * sample data is deterministic per-process anyway.
 */
import type { CalendarResponse, EconomicEvent } from "@/lib/calendar/schema";
import { sampleCalendar } from "@/lib/calendar/fallback";

const CACHE_TTL_MS = 5 * 60 * 1000;

let _cache: {
  events: EconomicEvent[];
  fetchedAt: string;
  expiresAt: number;
} | null = null;

/**
 * Fetch the economic calendar for [now - 2d, now + 14d].
 *
 * @param force bypass the cache (Refresh button)
 */
export async function fetchCalendar(force = false): Promise<CalendarResponse> {
  const now = Date.now();
  if (!force && _cache && now < _cache.expiresAt) {
    return {
      events: _cache.events,
      fetched_at: _cache.fetchedAt,
      window_start: _cache.events[0]?.time ?? new Date(now - 2 * 86_400_000).toISOString(),
      window_end: _cache.events[_cache.events.length - 1]?.time ?? new Date(now + 14 * 86_400_000).toISOString(),
      has_live: false,
      note: "Sample data - configure a provider for live economic events.",
    };
  }

  const events = sampleCalendar(now);
  const fetchedAt = new Date(now).toISOString();

  _cache = {
    events,
    fetchedAt,
    expiresAt: now + CACHE_TTL_MS,
  };

  const windowStart = events[0]?.time ?? new Date(now - 2 * 86_400_000).toISOString();
  const windowEnd = events[events.length - 1]?.time ?? new Date(now + 14 * 86_400_000).toISOString();

  return {
    events,
    fetched_at: fetchedAt,
    window_start: windowStart,
    window_end: windowEnd,
    has_live: false,
    note: "Sample data - configure a provider for live economic events.",
  };
}
