/**
 * Finnhub news client - server-only.
 *
 * Endpoint: https://finnhub.io/api/v1/news?category=forex
 *
 * - Free tier: 60 calls/min. We cache results for 5 minutes to stay
 *   well under that.
 * - Returns the latest 50 forex headlines. We map each to our
 *   NewsItem shape and extract related currencies server-side.
 *
 * If the request fails (network, 429, 401), we throw a NewsProviderError
 * so the API layer can fall back to the sample dataset.
 */

import type { NewsItem } from "@/lib/news/schema";
import { extractCurrencies } from "@/lib/news/schema";
import { finnhubKey } from "@/lib/news/config";

export class NewsProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NewsProviderError";
  }
}

/** Raw Finnhub news item shape (subset of fields we use). */
interface FinnhubNewsRaw {
  id: number;
  category: string;
  datetime: number; // unix seconds
  headline: string;
  source: string;
  summary: string;
  url: string;
  related?: string; // comma-separated tickers, e.g. "EURUSD,USDJPY"
}

const FINNHUB_ENDPOINT = "https://finnhub.io/api/v1/news";

/**
 * Fetch the latest forex news from Finnhub. Returns normalized items
 * (most-recent first).
 *
 * @param limit cap on items returned (1..50)
 */
export async function fetchFinnhubNews(limit = 30): Promise<NewsItem[]> {
  const url = `${FINNHUB_ENDPOINT}?category=forex&token=${finnhubKey()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      // Finnhub allows up to 60 req/min; cache at the fetch layer too.
      next: { revalidate: 300 },
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new NewsProviderError(
      `Network error reaching Finnhub: ${err instanceof Error ? err.message : "unknown"}`,
      503,
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new NewsProviderError("Finnhub API key is invalid or unauthorized.", res.status);
  }
  if (res.status === 429) {
    throw new NewsProviderError("Finnhub rate limit reached; try again in a minute.", 429);
  }
  if (!res.ok) {
    throw new NewsProviderError(
      `Finnhub returned HTTP ${res.status}.`,
      res.status,
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new NewsProviderError("Finnhub returned non-JSON response.", 502);
  }

  if (!Array.isArray(raw)) {
    throw new NewsProviderError("Finnhub returned a non-array response.", 502);
  }

  // Normalize: Finnhub already returns most-recent-first.
  const items: NewsItem[] = (raw as FinnhubNewsRaw[])
    .filter((r) => typeof r?.headline === "string" && r.headline.length > 0)
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((r) => normalizeFinnhubItem(r));

  return items;
}

function normalizeFinnhubItem(r: FinnhubNewsRaw): NewsItem {
  // Finnhub's `related` field is e.g. "EURUSD,USDJPY,XAUUSD"
  // (concatenated pair codes). Split, take the unique currency codes.
  const relatedFromField = (r.related ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  // From pair codes, derive individual ccys; also scan headline+summary
  // for any we missed.
  const relatedCcys = new Set<string>();
  for (const code of relatedFromField) {
    if (code.length === 6) {
      relatedCcys.add(code.slice(0, 3));
      relatedCcys.add(code.slice(3));
    } else if (code.length === 3) {
      relatedCcys.add(code);
    } else if (code === "XAUUSD") {
      relatedCcys.add("XAU");
      relatedCcys.add("USD");
    }
  }

  const textCcys = extractCurrencies(`${r.headline} ${r.summary ?? ""}`);
  for (const c of textCcys) relatedCcys.add(c);

  return {
    id: `finnhub-${r.id}`,
    source: (r.source ?? "Finnhub").slice(0, 80),
    headline: r.headline.slice(0, 280),
    summary: (r.summary ?? "").slice(0, 1000),
    url: r.url,
    published_at: new Date(r.datetime * 1000).toISOString(),
    related: Array.from(relatedCcys),
    categories: r.category ? [r.category.toLowerCase()] : [],
  };
}
