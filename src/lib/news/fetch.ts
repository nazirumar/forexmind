/**
 * News fetch dispatcher with in-memory cache + graceful fallback.
 *
 * Strategy:
 *  1. If a provider is configured (Finnhub preferred), call it.
 *  2. On failure OR no provider configured, return the sample
 *     dataset so the page never appears broken.
 *  3. Cache successful results for 5 minutes (both for the live
 *     provider and the sample dataset, since both are deterministic
 *     enough that a refresh every 5 min is fine).
 *
 * The cache is process-local (in-memory). It survives across requests
 * within the same Node process; in serverless deploys each cold start
 * rebuilds it, which is fine - a cache miss just means one upstream
 * call per cold start, well within provider limits.
 */
import type { NewsItem, NewsResponse } from "@/lib/news/schema";
import {
  isFinnhubConfigured,
  isNewsConfigured,
  preferredProvider,
} from "@/lib/news/config";
import { fetchFinnhubNews, NewsProviderError } from "@/lib/news/finnhub";
import { scrapeNews, NewsScrapeError } from "@/lib/news/scraper";
import { sampleNews } from "@/lib/news/fallback";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CacheEntry = {
  items: NewsItem[];
  provider: "finnhub" | "scraper" | "twelvedata" | "sample";
  fetchedAt: string;
  expiresAt: number;
  note?: string;
};

let _cache: CacheEntry | null = null;

function isFresh(entry: CacheEntry | null): boolean {
  if (!entry) return false;
  return Date.now() < entry.expiresAt;
}

/**
 * Fetch the latest forex news. Falls back to the sample dataset on
 * any provider error or when no provider is configured.
 *
 * @param limit 1..50 items
 * @param force  bypass the in-memory cache (Refresh button)
 */
export async function fetchNews(
  limit = 30,
  force = false,
): Promise<NewsResponse> {
  if (!force && isFresh(_cache)) {
    return {
      items: _cache!.items,
      provider: _cache!.provider,
      fetched_at: _cache!.fetchedAt,
      cached: true,
      note: _cache!.note,
    };
  }

  // No provider configured -> sample, but still cache to avoid
  // recomputing the relative times on every request.
  if (!isNewsConfigured()) {
    // No paid provider key - use the RSS scraper (keyless) before
    // falling back to the sample dataset.
    try {
      const scraped = await scrapeNews();
      const items = scraped.slice(0, Math.max(1, Math.min(50, limit)));
      _cache = {
        items,
        provider: "scraper",
        fetchedAt: new Date().toISOString(),
        expiresAt: Date.now() + CACHE_TTL_MS,
        note: "Live headlines scraped from public forex news feeds (no API key needed).",
      };
      return {
        items,
        provider: "scraper",
        fetched_at: _cache.fetchedAt,
        cached: false,
        note: _cache.note,
      };
    } catch (err) {
      const reason =
        err instanceof NewsScrapeError ? err.message : "Unknown scraper error.";
      const items = sampleNews().slice(0, Math.max(1, Math.min(50, limit)));
      _cache = {
        items,
        provider: "sample",
        fetchedAt: new Date().toISOString(),
        expiresAt: Date.now() + CACHE_TTL_MS,
        note: `RSS scrape failed (${reason}). Showing sample data instead.`,
      };
      return {
        items,
        provider: "sample",
        fetched_at: _cache.fetchedAt,
        cached: false,
        note: _cache.note,
      };
    }
  }

  const provider = preferredProvider();
  let items: NewsItem[];
  let usedProvider: "finnhub" | "scraper" | "twelvedata" | "sample" = "sample";
  let note: string | undefined;

  if (provider === "finnhub") {
    try {
      items = await fetchFinnhubNews(limit);
      usedProvider = "finnhub";
      // Finnhub's forex feed can be very sparse (sometimes 1-2 items).
      // Top it up with RSS-scraped headlines so the page never looks
      // nearly empty while a key is configured.
      if (items.length < 10) {
        try {
          const scraped = await scrapeNews();
          const seen = new Set(items.map((i) => i.headline.toLowerCase().slice(0, 80)));
          const topUp = scraped
            .filter((i) => !seen.has(i.headline.toLowerCase().slice(0, 80)))
            .slice(0, limit - items.length);
          if (topUp.length > 0) {
            items = [...items, ...topUp];
            note = `Finnhub returned only ${items.length - topUp.length} item(s); topped up from public RSS feeds.`;
          }
        } catch {
          // Scrape top-up is best-effort; keep the Finnhub result as-is.
        }
      }
    } catch (err) {
      // Fall back to sample data; surface the reason to the UI.
      const reason =
        err instanceof NewsProviderError
          ? err.message
          : "Unknown provider error.";
      items = sampleNews().slice(0, limit);
      usedProvider = "sample";
      note = `Live provider failed: ${reason} Showing sample data instead.`;
    }
  } else if (provider === "twelvedata") {
    // Twelve Data doesn't have a forex news endpoint at the free tier;
    // we fall back to sample data with a note when it's the only key set.
    items = sampleNews().slice(0, limit);
    usedProvider = "sample";
    note =
      "Twelve Data has no news endpoint on the free tier. Showing sample data. Set FINNHUB_API_KEY for live headlines.";
  } else {
    items = sampleNews().slice(0, limit);
    usedProvider = "sample";
    note = "Sample data.";
  }

  _cache = {
    items,
    provider: usedProvider,
    fetchedAt: new Date().toISOString(),
    expiresAt: Date.now() + CACHE_TTL_MS,
    note,
  };

  return {
    items,
    provider: usedProvider,
    fetched_at: _cache.fetchedAt,
    cached: false,
    note,
  };
}
