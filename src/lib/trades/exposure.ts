/**
 * Exposure & correlation analytics (Feature 3).
 *
 * Turns a user's OPEN trades into:
 *  - net directional exposure per currency (am I long USD? short EUR?)
 *  - a flat "risk exposure" view (how much $ at risk per pair, still open)
 *  - correlated over-exposure warnings (long EURUSD + long GBPUSD =
 *    doubling up on USD-short)
 *
 * "Open" = a trade with no closed_at (or null pnl). Once closed, a
 * trade no longer contributes to live exposure.
 *
 * The correlation matrix is a static, well-known forex fact table
 * (EURUSD/GBPUSD ~0.7, EURUSD/USDCHF ~-0.9, etc.) sourced from
 * long-run daily-return correlations. It does not require live data.
 *
 * Pure: no I/O.
 */
import type { TradeRow } from "@/lib/trades/schema";

/** Split "EURUSD" -> ["EUR", "USD"]. "XAUUSD" -> ["XAU", "USD"]. */
function legs(pair: string): [string, string] {
  const p = pair.toUpperCase().replace(/[^A-Z]/g, "");
  return [p.slice(0, 3), p.slice(3, 6)];
}

// ---------------------------------------------------------------------------
// Net directional exposure by currency
// ---------------------------------------------------------------------------

export type CurrencyExposure = {
  currency: string;
  /** Net lots long (positive) / short (negative). */
  netLots: number;
  /** Number of open trades contributing. */
  trades: number;
  /** "$" at risk still open on this currency's trades. */
  openRisk: number;
};

/**
 * Net exposure per currency across OPEN trades.
 *
 * A BUY of 1.0 lot EURUSD adds +1.0 to EUR and -1.0 to USD.
 * A SELL of 0.5 lot GBPUSD adds -0.5 to GBP and +0.5 to USD.
 *
 * The sign convention: buying the pair = long the base currency, short
 * the quote. So the "net lots" for a currency is the sum of base-side
 * lots for buys of pairs where it's the base, minus quote-side lots,
 * etc. A large net position in one currency means the trader is
 * concentrated.
 *
 * Returns currencies sorted by |netLots| descending (biggest net
 * exposure first). Pure.
 */
export function netExposureByCurrency(trades: TradeRow[]): CurrencyExposure[] {
  const map = new Map<string, { netLots: number; trades: number; openRisk: number }>();

  for (const t of trades) {
    if (t.closed_at != null && t.pnl != null) continue; // closed
    const [base, quote] = legs(t.pair);
    const sign = t.direction === "buy" ? 1 : -1;
    const lots = t.lot_size;

    for (const [cur, legSign] of [[base, sign], [quote, -sign]] as const) {
      const entry = map.get(cur) ?? { netLots: 0, trades: 0, openRisk: 0 };
      entry.netLots += legSign * lots;
      entry.trades += 1;
      entry.openRisk += t.risk_amount ?? 0;
      map.set(cur, entry);
    }
  }

  const out: CurrencyExposure[] = [];
  for (const [currency, e] of map) {
    if (Math.abs(e.netLots) < 1e-9 && e.trades === 0) continue;
    out.push({ currency, netLots: e.netLots, trades: e.trades, openRisk: e.openRisk });
  }
  out.sort((a, b) => Math.abs(b.netLots) - Math.abs(a.netLots));
  return out;
}

// ---------------------------------------------------------------------------
// Per-pair open risk
// ---------------------------------------------------------------------------

export type PairExposure = {
  pair: string;
  direction: "buy" | "sell";
  lots: number;
  /** $ at risk if SL hit (null when risk_amount not recorded). */
  risk: number | null;
  openedAt: string;
};

/**
 * List open trades as a flat exposure table. Sorted by opened_at desc
 * (most recent first). Pure.
 */
export function openPositions(trades: TradeRow[]): PairExposure[] {
  const out: PairExposure[] = [];
  for (const t of trades) {
    if (t.closed_at != null && t.pnl != null) continue;
    out.push({
      pair: t.pair,
      direction: t.direction,
      lots: t.lot_size,
      risk: t.risk_amount ?? null,
      openedAt: t.opened_at,
    });
  }
  out.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  return out;
}

// ---------------------------------------------------------------------------
// Correlated over-exposure warnings
// ---------------------------------------------------------------------------

export type CorrelationWarning = {
  pairA: string;
  pairB: string;
  /** Correlation coefficient in [-1, 1]. */
  correlation: number;
  /** Same-direction exposure on both = amplified risk. */
  netLots: number;
  message: string;
};

/**
 * Static long-run daily-return correlation table for major forex pairs.
 * Values are approximate industry consensus (Investopedia / Babypips).
 * Only pairs with |correlation| >= 0.5 are listed (the rest are
 * effectively independent).
 */
const CORRELATIONS: Record<string, Record<string, number>> = {
  EURUSD: { GBPUSD: 0.88, NZDUSD: 0.65, AUDUSD: 0.7, USDCHF: -0.95, USDJPY: -0.5 },
  GBPUSD: { EURUSD: 0.88, AUDUSD: 0.7, NZDUSD: 0.68, USDCHF: -0.85 },
  AUDUSD: { NZDUSD: 0.88, GBPUSD: 0.7, EURUSD: 0.7, USDJPY: 0.5 },
  NZDUSD: { AUDUSD: 0.88, GBPUSD: 0.68, EURUSD: 0.65 },
  USDCHF: { EURUSD: -0.95, GBPUSD: -0.85, USDJPY: 0.45 },
  USDJPY: { EURUSD: -0.5, USDCHF: 0.45, AUDUSD: 0.5 },
  USDCAD: { USDJPY: 0.4, USDCHF: 0.45 },
};

/** Lookup correlation (symmetric). 0 when not in the table. */
function correlation(a: string, b: string): number {
  if (a === b) return 1;
  return CORRELATIONS[a]?.[b] ?? CORRELATIONS[b]?.[a] ?? 0;
}

/**
 * Detect correlated over-exposure among OPEN positions.
 *
 * For each pair of open trades on different pairs, look up the
 * long-run correlation. When two trades are on highly-correlated
 * pairs (|corr| >= 0.6) AND in the same effective direction (both
 * long the base, or both short), flag it: the trader is doubling up
 * on the same underlying currency move.
 *
 * Negative correlation in the same direction (e.g. long EURUSD + long
 * USDCHF, corr -0.95) is actually a HEDGE and is also flagged because
 * it usually means the trader didn't realise they're flatting
 * themselves.
 *
 * Returns warnings sorted by |correlation| descending. Pure.
 */
export function correlatedExposure(trades: TradeRow[]): CorrelationWarning[] {
  const open = trades.filter((t) => t.closed_at == null || t.pnl == null);
  const out: CorrelationWarning[] = [];

  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i]!;
      const b = open[j]!;
      if (a.pair === b.pair) continue;
      const corr = correlation(a.pair, b.pair);
      if (Math.abs(corr) < 0.6) continue;

      // Effective direction: +1 = long base, -1 = short base.
      const dirA = a.direction === "buy" ? 1 : -1;
      const dirB = b.direction === "buy" ? 1 : -1;
      const sameSide = dirA === dirB;
      const combinedLots = a.lot_size + b.lot_size;

      let message: string;
      if (corr > 0 && sameSide) {
        message =
          `Long ${a.pair} + ${sameSide ? "long" : "short"} ${b.pair} (corr ${corr.toFixed(2)}): ` +
          `you're doubling up on the same move. Effective risk ≈ ${(combinedLots).toFixed(2)} lots, not ${a.lot_size.toFixed(2)} + ${b.lot_size.toFixed(2)} separately.`;
      } else if (corr < 0 && sameSide) {
        message =
          `Long ${a.pair} + long ${b.pair} (corr ${corr.toFixed(2)}): these largely cancel out. ` +
          `You may be accidentally hedging — check whether you meant to take both.`;
      } else {
        // Opposite sides on correlated pair = also doubling up (short the
        // same move via the inverse pair).
        message =
          `${a.pair} + ${b.pair} (corr ${corr.toFixed(2)}), opposite sides: ` +
          `effectively the same directional bet. Combined exposure ≈ ${combinedLots.toFixed(2)} lots.`;
      }

      out.push({
        pairA: a.pair,
        pairB: b.pair,
        correlation: corr,
        netLots: combinedLots,
        message,
      });
    }
  }
  out.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return out;
}

// ---------------------------------------------------------------------------
// Exposure summary (for the dashboard card)
// ---------------------------------------------------------------------------

export type ExposureSummary = {
  openCount: number;
  totalOpenLots: number;
  totalOpenRisk: number | null;
  byCurrency: CurrencyExposure[];
  warnings: CorrelationWarning[];
  /** Largest single-currency net exposure (most concentrated bet). */
  mostConcentrated: CurrencyExposure | null;
};

/**
 * One-call summary for the exposure dashboard card. Pure.
 */
export function exposureSummary(trades: TradeRow[]): ExposureSummary {
  const open = trades.filter((t) => t.closed_at == null || t.pnl == null);
  const byCurrency = netExposureByCurrency(trades);
  const warnings = correlatedExposure(trades);

  let totalOpenLots = 0;
  let totalOpenRisk = 0;
  let hasRisk = false;
  for (const t of open) {
    totalOpenLots += t.lot_size;
    if (t.risk_amount != null) {
      totalOpenRisk += t.risk_amount;
      hasRisk = true;
    }
  }

  return {
    openCount: open.length,
    totalOpenLots,
    totalOpenRisk: hasRisk ? totalOpenRisk : null,
    byCurrency,
    warnings,
    mostConcentrated: byCurrency[0] ?? null,
  };
}
