/**
 * Live FX price schema + types + pure helpers.
 *
 * A PriceQuote is the rate for one pair, fetched from the free
 * open.er-api.com endpoint (or any future provider). The schema is
 * intentionally minimal: pair, rate, fetched_at. Providers that
 * return bid/ask spreads can be added later without breaking the
 * UI (the UI only reads `rate`).
 */
import { z } from "zod";

export const priceQuoteSchema = z.object({
  /** Normalized pair code, e.g. "EURUSD". */
  pair: z.string().length(6),
  /** Current rate (units of quote ccy per 1 unit of base). */
  rate: z.number().positive(),
  /** ISO timestamp of when the rate was fetched. */
  fetched_at: z.string(),
  /** True when the rate is stale (cache hit older than 5 min). */
  stale: z.boolean().default(false),
});

export type PriceQuote = z.infer<typeof priceQuoteSchema>;

/**
 * Response envelope returned by GET /api/prices.
 *  - quotes: array of PriceQuote, one per supported pair
 *  - fetched_at: when the server fetched the page (for cache UI)
 *  - cached: true when the response came from the in-memory cache
 *  - note: optional reason when a provider returned partial data
 */
export const priceResponseSchema = z.object({
  quotes: z.array(priceQuoteSchema),
  fetched_at: z.string(),
  cached: z.boolean(),
  /** Base currency the rates are relative to (always "USD" for the free API). */
  base: z.string(),
  note: z.string().optional(),
});

export type PriceResponse = z.infer<typeof priceResponseSchema>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Build the 16 supported pair rates from a flat "rates relative to USD" map.
 *
 * The free API returns `{ rates: { EUR: 0.92, JPY: 150.5, ... } }` - all
 * relative to USD. We need to derive cross rates:
 *  - EURUSD = rates.EUR (1 USD = 0.92 EUR, but we want 1 EUR = x USD, so 1/0.92)
 *  - USDJPY = rates.JPY (1 USD = 150.5 JPY - already what we want)
 *  - EURJPY = EURUSD * USDJPY = (1/rates.EUR) * rates.JPY
 *  - GBPJPY = (1/rates.GBP) * rates.JPY
 *  - EURGBP = rates.GBP / rates.EUR (1 EUR = x GBP)
 *  - etc.
 *
 * Convention: "EURUSD rate = 1.0850" means 1 EUR = 1.0850 USD. So:
 *  - For XXXUSD pairs (EURUSD, GBPUSD, AUDUSD, NZDUSD): rate = 1 / rates.XXX
 *  - For USDXXX pairs (USDJPY, USDCHF, USDCAD): rate = rates.XXX
 *  - For cross pairs XXXYYY (EURJPY, GBPJPY, EURGBP, EURCHF, AUDJPY,
 *    GBPAUD, AUDCAD, NZDJPY): rate = rates.YYY / rates.XXX
 *  - XAUUSD: not available from the free API (no gold rate). Returns null.
 *
 * Pure function: takes the rates map, returns the derived quotes.
 */
export function deriveQuotes(
  rates: Record<string, number>,
  fetchedAt: string,
  stale: boolean = false,
): PriceQuote[] {
  const out: PriceQuote[] = [];
  const r = rates;

  for (const pair of [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD",
    "NZDUSD", "EURJPY", "GBPJPY", "EURGBP", "EURCHF", "AUDJPY",
    "GBPAUD", "AUDCAD", "NZDJPY",
  ]) {
    const base = pair.slice(0, 3);
    const quote = pair.slice(3);
    let rate: number;

    if (base === "USD") {
      // USDXXX: rate = rates[XXX]
      rate = r[quote] ?? NaN;
    } else if (quote === "USD") {
      // XXXUSD: rate = 1 / rates[XXX]
      rate = r[base] != null ? 1 / r[base] : NaN;
    } else {
      // Cross XXXYYY: rate = rates[YYY] / rates[XXX]
      rate =
        r[base] != null && r[quote] != null
          ? r[quote] / r[base]
          : NaN;
    }

    if (Number.isFinite(rate) && rate > 0) {
      out.push({ pair, rate, fetched_at: fetchedAt, stale });
    }
  }

  // XAUUSD: the free API doesn't return gold. Skip it (the UI shows "—").
  // We could add a separate metals API later; for now, no quote.

  return out;
}

/** Format a rate for display. 5 significant digits for non-JPY, 3 for JPY pairs. */
export function formatRate(pair: string, rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  // JPY pairs: 3 decimal places (e.g. 150.250)
  // XAUUSD: 2 decimal places (e.g. 2045.50) - though we don't fetch it
  // Everything else: 5 decimal places (e.g. 1.08502)
  if (pair.endsWith("JPY")) return rate.toFixed(3);
  if (pair === "XAUUSD") return rate.toFixed(2);
  return rate.toFixed(5);
}

/**
 * Compute the day-change approximation. The free API doesn't return
 * historical data, so we can't compute a real day change. This is a
 * placeholder that returns null - the UI hides the change indicator
 * when it's null.
 *
 * Future: swap to a provider that returns `change` in the response.
 */
export function dayChange(): number | null {
  return null;
}
