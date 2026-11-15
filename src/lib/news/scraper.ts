/**
 * RSS web-scraper for forex news (server-only).
 *
 * Pulls headlines from public forex news RSS feeds - no API key
 * required. Chosen sources are bot-tolerant (ForexLive, for example,
 * 403s Cloudflare-challenged requests, so it is NOT in the list):
 *
 *  - FXStreet      https://www.fxstreet.com/rss/news       (CDATA, RFC-822 dates)
 *  - Investing.com https://www.investing.com/rss/news_1.rss (plain, "YYYY-MM-DD HH:mm:ss" dates)
 *
 * Zero dependencies: RSS 2.0 is simple XML, so we parse with regexes
 * over the raw text. Deliberately forgiving - a malformed item is
 * skipped, not fatal, and a failed feed is skipped as long as at
 * least one source returns items.
 */
import { extractCurrencies, type NewsItem } from "@/lib/news/schema";

export class NewsScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsScrapeError";
  }
}

type RssSource = {
  /** Display name put on every item from this feed. */
  name: string;
  url: string;
};

const SCRAPE_SOURCES: RssSource[] = [
  { name: "FXStreet", url: "https://www.fxstreet.com/rss/news" },
  {
    name: "Investing.com",
    url: "https://www.investing.com/rss/news_1.rss",
  },
];

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ITEMS_PER_SOURCE = 30;

// A real browser UA - some feeds reject unknown clients outright.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Decode the handful of XML entities RSS feeds actually use. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function textOf(block: string, tag: string): string | null {
  // <tag ...>content</tag> with optional CDATA + attributes.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return decodeEntities(stripCdata(m[1])).trim();
}

/**
 * Parse both known date shapes:
 *  - RFC-822:  "Fri, 13 Nov 2026 20:23:53 GMT"
 *  - ISO-ish:  "2026-11-14 00:06:59"  (Investing.com; treated as UTC)
 * Returns "" when unparseable (the schema requires the field, so
 * items without a usable date fall back to now - they are still
 * fresh off the feed).
 */
function parseFeedDate(raw: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return new Date().toISOString();
}

type RawItem = {
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
};

/** Extract <item> blocks from an RSS/Atom document. */
function extractItems(xml: string, sourceName: string): RawItem[] {
  const out: RawItem[] = [];
  // Match both <item>...</item> (RSS 2.0) and <entry>...</entry> (Atom).
  const blocks = xml.match(/<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g) ?? [];
  for (const block of blocks) {
    const title = textOf(block, "title");
    // Atom feeds put the link in an href attribute; RSS uses element text.
    let link = textOf(block, "link");
    if (!link) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = href ? href[1] : null;
    }
    if (!title || !link) continue;
    const summary =
      textOf(block, "description") ?? textOf(block, "summary") ?? textOf(block, "content") ?? "";
    out.push({
      source: sourceName,
      title: title.slice(0, 280),
      summary: summary.replace(/<[^>]*>/g, "").slice(0, 1000), // strip stray HTML
      url: link,
      publishedAt: parseFeedDate(textOf(block, "pubDate") ?? textOf(block, "updated")),
    });
  }
  return out;
}

async function fetchFeed(source: RssSource): Promise<RawItem[]> {
  const res = await fetch(source.url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new NewsScrapeError(`${source.name} returned HTTP ${res.status}`);
  const xml = await res.text();
  return extractItems(xml, source.name).slice(0, MAX_ITEMS_PER_SOURCE);
}

/**
 * Scrape all configured feeds, merge, dedupe by URL, newest first.
 * Never throws as long as at least one feed yields items; only
 * throws NewsScrapeError when everything failed (the dispatcher
 * falls back to the next provider).
 */
export async function scrapeNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(SCRAPE_SOURCES.map(fetchFeed));

  const items: NewsItem[] = [];
  const failures: string[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      for (const raw of r.value) {
        const key = raw.url.split("?")[0];
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        items.push({
          id: `scrape-${raw.source}-${key.slice(-60)}`,
          source: raw.source,
          headline: raw.title,
          summary: raw.summary,
          url: raw.url,
          published_at: raw.publishedAt,
          related: extractCurrencies(`${raw.title} ${raw.summary}`),
          categories: ["scraped"],
        });
      }
    } else {
      failures.push(
        `${SCRAPE_SOURCES[i].name}: ${r.reason instanceof Error ? r.reason.message : "failed"}`,
      );
    }
  }

  if (items.length === 0) {
    throw new NewsScrapeError(
      `All feeds failed: ${failures.join("; ") || "no items found"}`,
    );
  }

  items.sort((a, b) => b.published_at.localeCompare(a.published_at));
  return items;
}
