/**
 * Live FX price configuration.
 *
 * ForexMind uses `open.er-api.com` (the free, no-key tier of
 * exchangerate.host) for live FX rates. It's:
 *  - Free, no API key, no signup
 *  - ~250 requests/hour per IP (we cache 5 min, so 12 calls/hour max)
 *  - Returns all rates relative to a base currency in one call
 *
 * In production you'd swap this for Twelve Data (websocket, real-time)
 * or Finnhub - but for the sandbox + most personal-use deployments,
 * the free no-key API is perfect. The `fetchLiveRates()` function is
 * the only place that knows the URL; swapping providers is a one-file
 * change.
 */

/** The 16 pairs ForexMind tracks, matching the risk calculator + journal dropdown. */
export const SUPPORTED_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "EURJPY",
  "GBPJPY",
  "EURGBP",
  "EURCHF",
  "AUDJPY",
  "GBPAUD",
  "AUDCAD",
  "NZDJPY",
  "XAUUSD",
] as const;

export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

/**
 * The free API returns rates relative to USD. For XAUUSD (gold) it
 * does NOT return a rate - we mark it as unavailable and the UI
 * falls back to "—" for the gold price.
 */
export const FREE_API_BASE = "USD";

/** open.er-api.com endpoint - free, no key. Returns { rates: { EUR: 0.92, ... } }. */
export const FREE_API_URL = "https://open.er-api.com/v6/latest/USD";

/** True always - the free API needs no configuration. */
export function isPricesConfigured(): boolean {
  return true;
}
