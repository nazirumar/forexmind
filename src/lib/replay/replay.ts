/**
 * Trade Replay - pure what-if math.
 *
 * Given an original trade + an adjusted scenario (same pair/direction,
 * possibly different entry/SL/TP/exit/lot), compute:
 *  - original PnL vs adjusted PnL (and the delta)
 *  - original RR vs adjusted RR
 *  - pip distances (entry->SL, entry->TP, entry->exit) for both
 *  - risk amount ($) and reward amount ($) at the adjusted lot
 *
 * No DB, no AI. Everything is deterministic arithmetic over the
 * existing risk.ts helpers.
 */
import {
  pipSize,
  priceDiffInPips,
  pipValuePerLot,
  riskRewardRatio,
} from "@/lib/risk";
import type { TradeRow } from "@/lib/trades/schema";

/** Adjusted scenario inputs. All required except exit (which may be null
 *  to model "what if I hadn't closed it yet"). */
export type ReplayInput = {
  pair: string;
  direction: "buy" | "sell";
  entry_price: number;
  stop_loss: number;
  take_profit: number | null;
  /** The hypothetical exit price. null = trade still open. */
  exit_price: number | null;
  lot_size: number;
};

/** A single side's pip distance + dollar value. */
export type LegMetrics = {
  pips: number;
  /** Dollar value of that pip distance at the given lot size. */
  dollars: number;
};

export type ReplayResult = {
  pair: string;
  direction: "buy" | "sell";
  /** Original trade's PnL (as recorded). null if the trade was open. */
  originalPnl: number | null;
  /** PnL the adjusted scenario would have produced. null if exit is null. */
  adjustedPnl: number | null;
  /** adjustedPnl - originalPnl. null if either is null. */
  pnlDelta: number | null;
  /** Original RR (entry/SL/TP). NaN if no TP. */
  originalRR: number;
  /** Adjusted RR. NaN if no TP. */
  adjustedRR: number;
  /** Risk leg (entry -> SL). */
  riskLeg: LegMetrics;
  /** Reward leg (entry -> TP). null if no TP. */
  rewardLeg: LegMetrics | null;
  /** Realized leg (entry -> exit). null if no exit. */
  realizedLeg: LegMetrics | null;
  /** Dollar amount at risk (riskLeg.dollars). */
  riskAmount: number;
  /** Dollar amount at target (rewardLeg.dollars). null if no TP. */
  rewardAmount: number | null;
};

/**
 * Compute pip-aware dollar value for a price move.
 *
 *   dollars = signedPips * pipValuePerLot * lotSize
 *
 * Sign convention: a move in the trade's favor is positive dollars,
 * a move against is negative. For a buy, target above entry = positive;
 * for a sell, target below entry = positive.
 *
 * `pips` in the returned object is the ABSOLUTE distance (for display);
 * `dollars` is signed (positive = profitable).
 */
function legDollars(
  pair: string,
  direction: "buy" | "sell",
  entry: number,
  target: number,
  lotSize: number,
): LegMetrics {
  const ps = pipSize(pair);
  // Raw signed distance: positive when target is above entry.
  const rawSignedPips = (target - entry) / ps;
  // For a sell, "profitable" is target BELOW entry, so flip the sign so
  // profitable moves are always positive dollars.
  const signedPips = direction === "buy" ? rawSignedPips : -rawSignedPips;
  const pv = pipValuePerLot(pair, entry);
  const dollars = signedPips * pv * lotSize;
  return {
    pips: Number(Math.abs(rawSignedPips).toFixed(2)),
    dollars: Number(dollars.toFixed(2)),
  };
}

/**
 * Compute the full what-if comparison.
 *
 * Pure. `original` is the recorded trade; `adjusted` is the scenario
 * the user wants to explore. The two may share the same values (to
 * see the original math broken down) or differ (to see what would
 * have changed).
 */
export function computeReplay(
  original: Pick<
    TradeRow,
    "pair" | "direction" | "entry_price" | "stop_loss" | "take_profit" | "exit_price" | "pnl" | "lot_size"
  >,
  adjusted: ReplayInput,
): ReplayResult {
  const { pair, direction } = adjusted;

  // Risk leg (entry -> SL), always computable.
  const riskLeg = legDollars(
    pair,
    direction,
    adjusted.entry_price,
    adjusted.stop_loss,
    adjusted.lot_size,
  );

  // Reward leg (entry -> TP), only if TP set.
  const rewardLeg =
    adjusted.take_profit != null
      ? legDollars(
          pair,
          direction,
          adjusted.entry_price,
          adjusted.take_profit,
          adjusted.lot_size,
        )
      : null;

  // Realized leg (entry -> exit), only if exit set.
  const realizedLeg =
    adjusted.exit_price != null
      ? legDollars(
          pair,
          direction,
          adjusted.entry_price,
          adjusted.exit_price,
          adjusted.lot_size,
        )
      : null;

  // Adjusted PnL = realized leg dollars (what you'd have made/lost).
  const adjustedPnl = realizedLeg ? realizedLeg.dollars : null;

  // Original PnL as recorded (may be null if the trade was open).
  const originalPnl =
    original.pnl != null && Number.isFinite(original.pnl) ? original.pnl : null;

  const pnlDelta =
    adjustedPnl != null && originalPnl != null
      ? Number((adjustedPnl - originalPnl).toFixed(2))
      : null;

  // RR = reward pips / risk pips. riskRewardRatio returns NaN if invalid.
  const riskPips = Math.abs(riskLeg.pips);
  const rewardPips = rewardLeg ? Math.abs(rewardLeg.pips) : NaN;
  const adjustedRR = riskRewardRatio(riskPips, rewardPips);

  // Original RR from the original trade's prices.
  const origRiskPips = Math.abs(
    priceDiffInPips(original.pair, original.entry_price, original.stop_loss),
  );
  const origRewardPips =
    original.take_profit != null
      ? Math.abs(
          priceDiffInPips(original.pair, original.entry_price, original.take_profit),
        )
      : NaN;
  const originalRR = riskRewardRatio(origRiskPips, origRewardPips);

  return {
    pair,
    direction,
    originalPnl,
    adjustedPnl,
    pnlDelta,
    originalRR: Number.isFinite(originalRR) ? Number(originalRR.toFixed(4)) : originalRR,
    adjustedRR: Number.isFinite(adjustedRR) ? Number(adjustedRR.toFixed(4)) : adjustedRR,
    riskLeg,
    rewardLeg,
    realizedLeg,
    // "Amount at risk" and "amount at target" are displayed as positive
    // magnitudes (how much you could lose / gain). The signed P&L of
    // each leg is kept in the leg objects for callers that need it.
    riskAmount: Math.abs(riskLeg.dollars),
    rewardAmount: rewardLeg ? Math.abs(rewardLeg.dollars) : null,
  };
}

/** Format a dollars value with sign + currency symbol. */
export function formatDollars(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/** Format a pip distance with sign. */
export function formatPips(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)} pips`;
}
