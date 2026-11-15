/**
 * News item schema, types, and pure display helpers.
 *
 * A NewsItem is the common shape that every provider's articles are
 * normalized into. The API layer does the translation; everything
 * downstream (route, UI) only ever sees this shape.
 */
import { z } from "zod";

export const newsItemSchema = z.object({
  id: z.string(),
  /** Source / publisher: "Reuters", "FXStreet", "Finnhub" etc. */
  source: z.string().max(80),
  headline: z.string().min(1).max(280),
  /** Short summary or first paragraph, max 1000 chars. */
  summary: z.string().max(1000).optional().default(""),
  url: z.string().url(),
  /** ISO date string of when the article was published. */
  published_at: z.string(),
  /** Lowercase ISO ccy codes the article mentions (e.g. ["USD","EUR"]). */
  related: z.array(z.string()).default([]),
  /** Categories from the provider, normalised to lowercase. */
  categories: z.array(z.string()).default([]),
});

export type NewsItem = z.infer<typeof newsItemSchema>;

/**
 * AI enrichment added by the curator agent (GET /api/news/curated).
 * Everything except `ai_summary` is optional so partial model output
 * still validates.
 */
export const curatedNewsItemSchema = newsItemSchema.extend({
  /** Neutral one-sentence factual summary written by the AI agent. */
  ai_summary: z.string().min(1).max(400),
  /** e.g. "monetary-policy" | "data" | "geopolitics" | "analysis" | "other". */
  category: z.string().max(40).default("other"),
  /** Agent-assigned forex relevance, 0-10 (UI sorts/orders by this). */
  weight: z.number().int().min(0).max(10).default(5),
});

export type CuratedNewsItem = z.infer<typeof curatedNewsItemSchema>;

export const curatedNewsResponseSchema = z.object({
  items: z.array(curatedNewsItemSchema),
  updated_at: z.string(),
  cached: z.boolean(),
  /** Optional reason when curation degraded (e.g. AI failed -> raw feed). */
  note: z.string().optional(),
});

export type CuratedNewsResponse = z.infer<typeof curatedNewsResponseSchema>;

/**
 * Response envelope returned by GET /api/news.
 * - `provider` tells the UI which source was actually used (so we can
 *   label "Sample data" vs "Finnhub" honestly).
 * - `fetched_at` is when the server fetched the page (for cache UI).
 * - `cached` is true when the response came from the in-memory cache.
 */
export const newsResponseSchema = z.object({
  items: z.array(newsItemSchema),
  provider: z.enum(["finnhub", "scraper", "twelvedata", "sample"]),
  fetched_at: z.string(),
  cached: z.boolean(),
  /** Optional reason when the provider returned no items. */
  note: z.string().optional(),
});
export type NewsResponse = z.infer<typeof newsResponseSchema>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Extract a list of ISO currency codes from a free-text headline+summary.
 * Used for both provider items (whose related-ccy metadata is missing
 * or sparse) and the sample dataset. Pure function.
 *
 * Matches the 8 liquid currencies plus a couple of common ones:
 *   USD EUR GBP JPY AUD CAD CHF NZD + XAU (gold)
 *
 * Returns uppercase, deduplicated, in the order they first appear.
 */
const KNOWN_CCYS = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "NZD",
  "XAU",
] as const;

export function extractCurrencies(text: string): string[] {
  const out: string[] = [];
  const upper = text.toUpperCase();
  for (const ccy of KNOWN_CCYS) {
    // Use word-boundary match so "USDJPY" yields both USD and JPY,
    // but "BOJ" alone doesn't false-positive into "JPY" just because
    // it ends in J. We accept USDJPY (no separator) as a special case
    // by scanning for the ccy as a substring at any position.
    if (upper.includes(ccy)) out.push(ccy);
  }
  // Dedup, preserving order
  return Array.from(new Set(out));
}

/**
 * True if any of the user's watchlist ccys appears in the item's
 * related set OR its headline/summary text. Pure.
 */
export function matchesWatchlist(
  item: Pick<NewsItem, "headline" | "summary" | "related">,
  watchlist: string[],
): boolean {
  if (watchlist.length === 0) return true; // empty watchlist = show all
  const upper = watchlist.map((c) => c.toUpperCase());
  // Fast path: check the related array
  if (item.related.some((r) => upper.includes(r.toUpperCase()))) return true;
  // Slow path: scan headline+summary
  const text = `${item.headline} ${item.summary ?? ""}`.toUpperCase();
  return upper.some((c) => text.includes(c));
}

/** Relative time formatter - shared with the journal's timeAgo for
 *  visual consistency, but duplicated here to keep this module pure. */
export function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(then).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Truncate a string to `n` chars, adding an ellipsis. */
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
