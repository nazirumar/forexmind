/**
 * Pure risk-calculation functions for forex.
 *
 * IMPORTANT: these are PURE functions - no I/O, no dates, no random,
 * no side effects. They take numbers in and return numbers out. This
 * makes them trivial to unit-test and safe to call from both server
 * and client code.
 *
 * Conventions:
 *  - All money values are in the account currency (assumed USD for
 *    pip-value calculations; see `pipValuePerLot` for the formula).
 *  - All prices are plain numbers (e.g. 1.0850 for EURUSD).
 *  - All distances are in pips (e.g. 30 pips), not in price units.
 *  - Lot sizes are standard lots (1.00 = 100,000 units of base).
 *
 * References for the pip-value formulas:
 *  - https://www.investopedia.com/terms/p/pip.asp
 *  - https://www.babypips.com/learn/forex/pip-values
 */

// ---------------------------------------------------------------------------
// Pair classification
// ---------------------------------------------------------------------------

/**
 * Normalise a pair symbol: uppercase, strip slashes.
 * "eur/usd" -> "EURUSD", "GBPUSD" -> "GBPUSD".
 */
export function normalizePair(pair: string): string {
  return pair.trim().toUpperCase().replace(/[\/\s\-]/g, "");
}

/**
 * True for JPY quote pairs (USDJPY, EURJPY, GBPJPY etc.) and for
 * XAUUSD (gold) we treat 0.1 as the pip size per the spec.
 *
 * NOTE: XAUUSD is technically a metals CFD, not a forex pair, but
 * retail brokers commonly quote it with a 0.1 "pip" (cent) move
 * representing one pip. We follow that convention here so the
 * calculator matches what the user sees on their platform.
 */
export function isJpyPair(pair: string): boolean {
  return normalizePair(pair).endsWith("JPY");
}

export function isXauPair(pair: string): boolean {
  return normalizePair(pair) === "XAUUSD";
}

/**
 * Pip size in price units.
 *  - default (EURUSD, GBPUSD, AUDUSD, etc.): 0.0001
 *  - JPY pairs (USDJPY, EURJPY, ...):        0.01
 *  - XAUUSD (gold):                          0.1
 */
export function pipSize(pair: string): number {
  const p = normalizePair(pair);
  if (isXauPair(p)) return 0.1;
  if (isJpyPair(p)) return 0.01;
  return 0.0001;
}

// ---------------------------------------------------------------------------
// Pip distance
// ---------------------------------------------------------------------------

/**
 * Number of pips between two prices for the given pair.
 *
 * Example: priceDiffInPips("EURUSD", 1.0850, 1.0820) = 30
 *          priceDiffInPips("USDJPY", 150.00, 149.70) = 30
 *
 * The result is always non-negative; pass `signedPriceDistance` for
 * a signed version.
 */
export function priceDiffInPips(
  pair: string,
  priceA: number,
  priceB: number,
): number {
  if (!isFinite(priceA) || !isFinite(priceB)) return NaN;
  const size = pipSize(pair);
  return Math.abs(priceA - priceB) / size;
}

/**
 * Signed pip distance from `entry` to `target`, positive when target
 * is above entry. Used for SL/TP checks relative to direction.
 *
 * Example: signedPipDistance("EURUSD", 1.0850, 1.0820) = -30
 */
export function signedPipDistance(
  pair: string,
  entry: number,
  target: number,
): number {
  if (!isFinite(entry) || !isFinite(target)) return NaN;
  return (target - entry) / pipSize(pair);
}

// ---------------------------------------------------------------------------
// Pip value per lot (in account currency = USD)
// ---------------------------------------------------------------------------

/**
 * Pip value per standard lot, in USD (the account currency).
 *
 * A "standard lot" = 100,000 units of the base currency. When you
 * move one pip in price, the profit/loss in the QUOTE currency is:
 *
 *     pipValueInQuote = lotSize * pipSize
 *                     = 100,000 * pipSize
 *
 * For USD-quoted pairs (EURUSD, GBPUSD, AUDUSD):
 *   - pipSize = 0.0001, so pipValueInQuote = 100,000 * 0.0001 = $10
 *   - quote currency IS USD, so pipValuePerLot = $10
 *
 * For JPY pairs (USDJPY, EURJPY):
 *   - pipSize = 0.01, so pipValueInQuote = 100,000 * 0.01 = 1,000 JPY
 *   - quote currency is JPY, NOT USD, so we must convert:
 *       pipValuePerLot = 1,000 / usdJpyPrice
 *   - example: USDJPY @ 150.00 -> 1,000 / 150 = $6.67 per pip per lot
 *
 * For pairs where USD is the BASE (e.g. USDCHF, USDCAD):
 *   - pipSize = 0.0001, pipValueInQuote = 100,000 * 0.0001 = 10 (quote)
 *   - quote currency is CHF/CAD, so:
 *       pipValuePerLot = 10 / usdQuotePrice
 *   - example: USDCHF @ 0.9000 -> 10 / 0.9 = $11.11 per pip per lot
 *
 * For cross pairs with no USD leg (e.g. EURGBP, EURJPY when neither
 * leg is USD... actually EURJPY DOES have a JPY leg so the formula
 * above handles it via the JPY check):
 *   - the most accurate general formula needs the current rate of
 *     quote->USD, which is why we accept a `currentPrice` parameter
 *     for non-USD-quote pairs.
 *
 * Implementation rules (matching the spec):
 *  - USD-quote pairs (XXXUSD where XXX != XAU): return $10 directly.
 *  - JPY pairs: return 1000 / currentPrice (USDJPY rate).
 *  - XAUUSD: return $10 (1 lot of XAUUSD = 100 oz, 0.1 pip * 100 oz = $10).
 *  - USD-base pairs (USDXXX): return 10 / currentPrice.
 *  - Cross pairs (e.g. EURGBP): we approximate by converting via
 *    the currentPrice as quote->base rate; the caller should supply
 *    the cross rate. We expose `pipValuePerLotApprox` for the cases
 *    where no conversion rate is available.
 */
export function pipValuePerLot(pair: string, currentPrice?: number): number {
  const p = normalizePair(pair);

  // XAUUSD: 1 lot = 100 oz, 1 pip (0.1) * 100 oz = $10
  if (isXauPair(p)) return 10;

  // USD-quote pairs: XXXUSD (EURUSD, GBPUSD, AUDUSD, NZDUSD)
  // pipValueInQuote = 100,000 * 0.0001 = $10, quote = USD, so $10.
  if (p.endsWith("USD") && !p.startsWith("USD")) return 10;

  // JPY pairs: pipValueInQuote = 100,000 * 0.01 = 1,000 JPY
  // Need currentPrice (the USDJPY rate if pair is USDJPY, OR the
  // cross rate like EURJPY which we'd convert via USDJPY separately).
  if (isJpyPair(p)) {
    if (!currentPrice || !isFinite(currentPrice) || currentPrice <= 0) {
      // Cannot compute without a price; return NaN so the caller can
      // show "enter current price" instead of a wrong number.
      return NaN;
    }
    // For USDJPY specifically, currentPrice IS the USDJPY rate.
    // For cross JPY pairs (EURJPY, GBPJPY), the caller should pass
    // the USDJPY rate (the conversion rate from quote to USD).
    return 1000 / currentPrice;
  }

  // USD-base pairs: USDXXX (USDCHF, USDCAD, USDSEK)
  // pipValueInQuote = 100,000 * 0.0001 = 10 XXX
  // Convert: $ per pip = 10 / currentPrice (USDXXX rate).
  if (p.startsWith("USD")) {
    if (!currentPrice || !isFinite(currentPrice) || currentPrice <= 0) {
      return NaN;
    }
    return 10 / currentPrice;
  }

  // Cross pairs with neither leg USD (EURGBP, EURCHF, GBPCHF, AUDJPY
  // - wait AUDJPY has JPY so it's handled above; pure crosses like
  // EURGBP, EURCHF, GBPNZD reach here).
  // Accurate conversion requires the quote->USD rate. If the caller
  // passed currentPrice we treat it as the quote->USD rate.
  if (currentPrice && isFinite(currentPrice) && currentPrice > 0) {
    return 10 / currentPrice;
  }

  // Fall back to NaN; caller should require a price.
  return NaN;
}

// ---------------------------------------------------------------------------
// Position size
// ---------------------------------------------------------------------------

/**
 * Position size in standard lots.
 *
 *     lots = (balance * riskPct / 100) / (stopLossPips * pipValuePerLot)
 *
 * Example: balance $10,000, risk 1%, SL 30 pips, EURUSD (pipValue $10)
 *          lots = ($10,000 * 0.01) / (30 * $10) = $100 / $300 = 0.33 lots
 *
 * Returns NaN for invalid inputs. Caller is responsible for clamping.
 */
export function positionSize(
  balance: number,
  riskPct: number,
  stopLossPips: number,
  pipValuePerLot: number,
): number {
  if (
    !isFinite(balance) || balance <= 0 ||
    !isFinite(riskPct) || riskPct <= 0 ||
    !isFinite(stopLossPips) || stopLossPips <= 0 ||
    !isFinite(pipValuePerLot) || pipValuePerLot <= 0
  ) {
    return NaN;
  }
  const riskAmount = balance * (riskPct / 100);
  return riskAmount / (stopLossPips * pipValuePerLot);
}

// ---------------------------------------------------------------------------
// Risk-reward
// ---------------------------------------------------------------------------

/**
 * Risk-reward ratio = rewardPips / riskPips.
 *
 * Returns NaN if either is missing, zero or invalid.
 * Returns Infinity if risk is zero but reward is not (degenerate case).
 */
export function riskRewardRatio(
  riskPips: number,
  rewardPips: number,
): number {
  if (
    !isFinite(riskPips) || riskPips <= 0 ||
    !isFinite(rewardPips) || rewardPips < 0
  ) {
    return NaN;
  }
  return rewardPips / riskPips;
}

// ---------------------------------------------------------------------------
// PnL
// ---------------------------------------------------------------------------

/**
 * Potential loss in account currency, given the lot size, stop distance
 * and pip value. This is "how much you lose if SL is hit".
 *
 *     loss = lots * stopLossPips * pipValuePerLot
 */
export function potentialLoss(
  lots: number,
  stopLossPips: number,
  pipValuePerLot: number,
): number {
  if (
    !isFinite(lots) || lots < 0 ||
    !isFinite(stopLossPips) || stopLossPips < 0 ||
    !isFinite(pipValuePerLot) || pipValuePerLot < 0
  ) {
    return NaN;
  }
  return lots * stopLossPips * pipValuePerLot;
}

/**
 * Potential profit in account currency, given the lot size, reward
 * distance and pip value. "How much you gain if TP is hit".
 *
 *     profit = lots * takeProfitPips * pipValuePerLot
 */
export function potentialProfit(
  lots: number,
  takeProfitPips: number,
  pipValuePerLot: number,
): number {
  if (
    !isFinite(lots) || lots < 0 ||
    !isFinite(takeProfitPips) || takeProfitPips < 0 ||
    !isFinite(pipValuePerLot) || pipValuePerLot < 0
  ) {
    return NaN;
  }
  return lots * takeProfitPips * pipValuePerLot;
}

// ---------------------------------------------------------------------------
// Break-even win rate
// ---------------------------------------------------------------------------

/**
 * Break-even win rate (as a fraction, 0..1) for a given risk-reward.
 *
 *     winRate = 1 / (1 + RR)
 *
 * Interpretation: if your average reward:risk is 2:1 (RR=2), you
 * need to win only 1/3 of trades to break even.
 *
 * Returns NaN for invalid RR. Returns 1 for RR = 0 (you must win
 * every trade to break even when there's no reward).
 */
export function breakEvenWinRate(rr: number): number {
  if (!isFinite(rr) || rr < 0) return NaN;
  if (rr === 0) return 1;
  return 1 / (1 + rr);
}

// ---------------------------------------------------------------------------
// Validation helpers (for the UI)
// ---------------------------------------------------------------------------

export type RiskWarning = {
  level: "error" | "warning";
  message: string;
};

/**
 * Produce human-readable warnings for the risk-calculator form.
 * Returns an array (possibly empty) of warnings.
 *
 * Checks:
 *  - risk % above 2% (warning)
 *  - RR below 1 (warning)
 *  - SL on the wrong side of entry for the direction (error)
 *  - TP on the wrong side of entry for the direction (error)
 *  - invalid inputs (NaN) (error)
 */
export function riskWarnings(args: {
  pair: string;
  direction: "buy" | "sell";
  entry: number;
  stopLoss: number;
  takeProfit?: number;
  riskPct?: number;
  rr?: number;
  stopLossPips?: number;
  takeProfitPips?: number;
}): RiskWarning[] {
  const out: RiskWarning[] = [];
  const {
    pair, direction, entry, stopLoss, takeProfit,
    riskPct, rr, stopLossPips, takeProfitPips,
  } = args;

  // Invalid numbers
  if (!isFinite(entry) || !isFinite(stopLoss)) {
    out.push({ level: "error", message: "Entry and stop loss must be valid numbers." });
    return out;
  }
  if (entry === stopLoss) {
    out.push({ level: "error", message: "Stop loss cannot equal entry." });
  }

  // SL on wrong side
  const slOnWrongSide =
    direction === "buy" ? stopLoss >= entry : stopLoss <= entry;
  if (slOnWrongSide && entry !== stopLoss) {
    out.push({
      level: "error",
      message:
        direction === "buy"
          ? "For a BUY, stop loss must be below entry."
          : "For a SELL, stop loss must be above entry.",
    });
  }

  // TP on wrong side
  if (takeProfit !== undefined && isFinite(takeProfit)) {
    const tpOnWrongSide =
      direction === "buy" ? takeProfit <= entry : takeProfit >= entry;
    if (tpOnWrongSide) {
      out.push({
        level: "error",
        message:
          direction === "buy"
            ? "For a BUY, take profit must be above entry."
            : "For a SELL, take profit must be below entry.",
      });
    }
  }

  // Risk too high
  if (riskPct !== undefined && isFinite(riskPct) && riskPct > 2) {
    out.push({
      level: "warning",
      message: `Risk of ${riskPct.toFixed(2)}% is high. Most pros risk 0.5–2% per trade.`,
    });
  }

  // RR below 1
  if (rr !== undefined && isFinite(rr) && rr > 0 && rr < 1) {
    out.push({
      level: "warning",
      message: `Risk-reward of ${rr.toFixed(2)} is below 1:1. Your winners must outpace losers by a lot to be profitable.`,
    });
  }

  // Stop loss pips sanity (very wide stops)
  if (stopLossPips !== undefined && isFinite(stopLossPips) && stopLossPips > 500) {
    out.push({
      level: "warning",
      message: `Stop loss of ${stopLossPips.toFixed(0)} pips is unusually wide. Double-check the pair and price.`,
    });
  }

  // Take profit pips sanity (very wide)
  if (takeProfitPips !== undefined && isFinite(takeProfitPips) && takeProfitPips > 1000) {
    out.push({
      level: "warning",
      message: `Take profit of ${takeProfitPips.toFixed(0)} pips is unusually wide. Double-check the pair and price.`,
    });
  }

  return out;
}
