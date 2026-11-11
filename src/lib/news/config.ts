/**
 * News provider configuration + "is it configured?" helper.
 *
 * ForexMind supports two market-data providers, picked by which env
 * var is set:
 *
 *   FINNHUB_API_KEY      - https://finnhub.io  (forex/macro news feed)
 *   TWELVE_DATA_API_KEY  -https://twelvedata.com (rates + prices)
 *
 * In the sandbox neither is set, so the news page degrades to a
 * deterministic sample dataset (see `fallback.ts`) instead of
 * crashing. In production at least one should be set.
 *
 * The keys themselves NEVER ship to the browser: every call to a
 * provider goes through /api/news which runs on the server. We only
 * expose booleans ("is configured?") client-side.
 */

const FINNHUB_KEY = process.env.FINNHUB_API_KEY ?? "";
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY ?? "";

function isPlaceholder(v: string): boolean {
  return v.length === 0 || v.includes("placeholder") || v.includes("your_");
}

export function isFinnhubConfigured(): boolean {
  return !isPlaceholder(FINNHUB_KEY);
}

export function isTwelveDataConfigured(): boolean {
  return !isPlaceholder(TWELVE_DATA_KEY);
}

/** True when at least one news provider is configured. */
export function isNewsConfigured(): boolean {
  return isFinnhubConfigured() || isTwelveDataConfigured();
}

export function finnhubKey(): string {
  return FINNHUB_KEY;
}

export function twelveDataKey(): string {
  return TWELVE_DATA_KEY;
}

/**
 * Which provider the API layer should try first.
 * Preference: Finnhub (richer forex news), then Twelve Data.
 */
export function preferredProvider(): "finnhub" | "twelvedata" | "none" {
  if (isFinnhubConfigured()) return "finnhub";
  if (isTwelveDataConfigured()) return "twelvedata";
  return "none";
}
