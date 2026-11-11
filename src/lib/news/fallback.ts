/**
 * Deterministic sample news dataset for the sandbox / preview.
 *
 * Used when neither FINNHUB_API_KEY nor TWELVE_DATA_API_KEY is set
 * (see config.ts). The contents here are intentionally generic,
 * evergreen market-education headlines - we don't want to claim
 * a real Reuters/Bloomberg timestamp that doesn't exist. The
 * `published_at` times are computed relative to "now" at module
 * load so the "1h ago" labels always look right.
 *
 * In production with a real provider configured, this dataset is
 * never returned.
 */
import type { NewsItem } from "@/lib/news/schema";

const minutesAgo = (m: number): string =>
  new Date(Date.now() - m * 60_000).toISOString();

/**
 * 10 evergreen headlines that touch the major currencies. Useful for
 * preview screenshots and for exercising the watchlist filter.
 */
export function sampleNews(): NewsItem[] {
  return [
    {
      id: "sample-1",
      source: "Sample",
      headline: "Dollar firms as traders eye next Fed decision",
      summary:
        "The US dollar traded slightly higher against major peers as markets positioned ahead of the next FOMC meeting. Treasury yields ticked up modestly.",
      url: "https://example.com/news/sample-1",
      published_at: minutesAgo(8),
      related: ["USD", "JPY"],
      categories: ["macro", "central-banks"],
    },
    {
      id: "sample-2",
      source: "Sample",
      headline: "Euro holds above parity as PMIs beat estimates",
      summary:
        "Eurozone services PMI came in above consensus, lending modest support to the single currency. Bund yields rose 2bps.",
      url: "https://example.com/news/sample-2",
      published_at: minutesAgo(35),
      related: ["EUR", "USD"],
      categories: ["macro", "data"],
    },
    {
      id: "sample-3",
      source: "Sample",
      headline: "Yen slides past 150 as BoJ stays accommodative",
      summary:
        "USDJPY broke above 150 after the Bank of Japan reaffirmed its easy stance. Intervention watch intensifies.",
      url: "https://example.com/news/sample-3",
      published_at: minutesAgo(70),
      related: ["JPY", "USD"],
      categories: ["macro", "central-banks"],
    },
    {
      id: "sample-4",
      source: "Sample",
      headline: "Pound steadies ahead of UK jobs report",
      summary:
        "GBPUSD found support near 1.26 as traders awaited the upcoming labor market release. Average earnings in focus.",
      url: "https://example.com/news/sample-4",
      published_at: minutesAgo(120),
      related: ["GBP", "USD"],
      categories: ["macro", "data"],
    },
    {
      id: "sample-5",
      source: "Sample",
      headline: "Gold consolidates near recent highs as yields ease",
      summary:
        "XAUUSD held firm as real yields slipped. Traders cited haven demand and a softer dollar index.",
      url: "https://example.com/news/sample-5",
      published_at: minutesAgo(180),
      related: ["XAU", "USD"],
      categories: ["metals"],
    },
    {
      id: "sample-6",
      source: "Sample",
      headline: "Aussie dollar buoyed by risk-on sentiment",
      summary:
        "AUDUSD pushed higher alongside regional equity gains. Iron ore prices were little changed.",
      url: "https://example.com/news/sample-6",
      published_at: minutesAgo(240),
      related: ["AUD", "USD"],
      categories: ["macro"],
    },
    {
      id: "sample-7",
      source: "Sample",
      headline: "Loonie trades mixed as oil holds steady",
      summary:
        "USDCAD hovered in a tight range with WTI crude flat. Next focus is the BoC rate decision.",
      url: "https://example.com/news/sample-7",
      published_at: minutesAgo(300),
      related: ["CAD", "USD"],
      categories: ["macro", "commodities"],
    },
    {
      id: "sample-8",
      source: "Sample",
      headline: "Swiss franc firms as safe-haven demand returns",
      summary:
        "USDCHF drifted lower amid renewed risk aversion. SNB sight deposits were little changed.",
      url: "https://example.com/news/sample-8",
      published_at: minutesAgo(420),
      related: ["CHF", "USD"],
      categories: ["macro"],
    },
    {
      id: "sample-9",
      source: "Sample",
      headline: "Kiwi supported by RBNZ hawkish lean",
      summary:
        "NZDUSD held gains as the RBNZ reiterated a cautious stance on cuts. Local bond yields rose.",
      url: "https://example.com/news/sample-9",
      published_at: minutesAgo(540),
      related: ["NZD", "USD"],
      categories: ["macro", "central-banks"],
    },
    {
      id: "sample-10",
      source: "Sample",
      headline: "Risk assets steady in thin holiday trade",
      summary:
        "FX majors traded in narrow ranges as several global centers observed holidays. Volumes below average.",
      url: "https://example.com/news/sample-10",
      published_at: minutesAgo(720),
      related: ["USD", "EUR", "JPY"],
      categories: ["macro"],
    },
  ];
}
