/**
 * Live FX price fetcher with 5-min in-memory cache.
 *
 * Strategy:
 *  - Fetch from open.er-api.com (free, no key) once every 5 minutes.
 *  - Cache the parsed quotes in module scope.
 *  - On cache hit, return immediately with `cached: true`.
 *  - On fetch failure, return the cached quotes (if any) with `stale: true`,
 *    or an empty array if we have no cache.
 *
 * The free API returns all rates relative to USD in one call, so we
 * make at most 1 upstream request per 5 minutes regardless of how
 * many clients ask. This keeps us well under the 250 req/hour IP limit.
 */
import { FREE_API_URL } from "@/lib/prices/config";
import {
  deriveQuotes,
  type PriceResponse,
  type PriceQuote,
} from "@/lib/prices/schema";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CacheEntry = {
  quotes: PriceQuote[];
  fetchedAt: string;
  expiresAt: number;
  base: string;
};

let _cache: CacheEntry | null = null;

function isFresh(entry: CacheEntry | null, now: number = Date.now()): boolean {
  if (!entry) return false;
  return now < entry.expiresAt;
}

/** Raw response shape from open.er-api.com. */
interface ErApiResult {
  result: string;
  base_code: string;
  rates: Record<string, number>;
  time_last_update_utc: string;
}

/**
 * Fetch live FX rates for the 16 supported pairs.
 *
 * Returns the derived quotes (cross rates computed from the USD-base
 * rates the API returns). Falls back to stale cache on network error.
 *
 * @param force bypass the cache (Refresh button)
 */
export async function fetchLiveRates(force = false): Promise<PriceResponse> {
  const now = Date.now();
  if (!force && isFresh(_cache, now)) {
    return {
      quotes: _cache!.quotes,
      fetched_at: _cache!.fetchedAt,
      cached: true,
      base: _cache!.base,
    };
  }

  let data: ErApiResult;
  try {
    const res = await fetch(FREE_API_URL, {
      next: { revalidate: 300 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    data = (await res.json()) as ErApiResult;
  } catch (err) {
    // Fetch failed. Return stale cache if we have one, else empty.
    if (_cache) {
      return {
        quotes: _cache.quotes.map((q) => ({ ...q, stale: true })),
        fetched_at: _cache.fetchedAt,
        cached: false,
        base: _cache.base,
        note: `Live fetch failed (${err instanceof Error ? err.message : "unknown"}); showing cached rates.`,
      };
    }
    return {
      quotes: [],
      fetched_at: new Date().toISOString(),
      cached: false,
      base: "USD",
      note: "Failed to fetch live rates. Please try again shortly.",
    };
  }

  if (data.result !== "success" || !data.rates) {
    return {
      quotes: [],
      fetched_at: new Date().toISOString(),
      cached: false,
      base: data.base_code ?? "USD",
      note: "The price API returned an unexpected response.",
    };
  }

  const fetchedAt = new Date().toISOString();
  const quotes = deriveQuotes(data.rates, fetchedAt, false);

  _cache = {
    quotes,
    fetchedAt,
    expiresAt: now + CACHE_TTL_MS,
    base: data.base_code ?? "USD",
  };

  return {
    quotes,
    fetched_at: fetchedAt,
    cached: false,
    base: _cache.base,
  };
}

/**
 * Get a single pair's rate from the cache, WITHOUT triggering a fetch.
 * Returns null when no cache or the pair isn't in the cache.
 *
 * Used by the risk calculator to auto-fill "current price" without
 * forcing a network call on every render.
 */
export function getCachedRate(pair: string): number | null {
  if (!_cache) return null;
  const q = _cache.quotes.find((x) => x.pair === pair);
  return q?.rate ?? null;
}
