/**
 * Performance breakdown: slice a user's trades by a single dimension
 * (session / strategy / pair / emotion / mistake type) and compute the
 * same stats the journal header shows, per group.
 *
 * Pure function, no I/O - takes TradeRow[] in, returns groups out.
 * Server pages and the AI routes can both use it (the checker/chat can
 * quote "your expectancy on the London session is +0.8R" from here).
 *
 * Conventions (matching src/lib/trades/schema.ts):
 *  - closed = pnl != null
 *  - winners = closed with pnl > 0
 *  - losers = closed with pnl <= 0 (breakeven counts as a loser)
 *  - profitFactor = grossProfit / |grossLoss|; null when there are no
 *    losers (we surface null rather than Infinity so the UI renders "—")
 *  - avgR = mean r_multiple over trades in the group that have one;
 *    null when none do
 *  - groups with null/empty dimension values are grouped under "—"
 */
import type { TradeRow } from "@/lib/trades/schema";

/** The dimensions a trade can be sliced by. */
export const BREAKDOWN_DIMENSIONS = [
  "session",
  "strategy",
  "pair",
  "emotion",
  "mistakeType",
] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export type BreakdownGroup = {
  /** Raw group key as stored on the trade (e.g. "london", "EURUSD"). */
  key: string;
  /** Trades in the group (open + closed). */
  total: number;
  /** Closed trades (pnl != null). */
  closed: number;
  winners: number;
  losers: number;
  /** winners / closed, 0..1 (0 when no closed trades). */
  winRate: number;
  netPnl: number;
  /** null when the group has no losers (no meaningful ratio). */
  profitFactor: number | null;
  /** Mean R-multiple across the group's trades that have one; null when none. */
  avgR: number | null;
};

/** Placeholder key for trades missing the dimension value. */
export const NO_VALUE = "—";

/** Read the dimension's raw value off a trade. */
function valueOf(t: TradeRow, dim: BreakdownDimension): string | null {
  switch (dim) {
    case "session":
      return t.session;
    case "strategy":
      return t.strategy;
    case "pair":
      return t.pair;
    case "emotion":
      return t.emotion;
    case "mistakeType":
      return t.mistake_type ?? null;
  }
}

/**
 * Group trades by dimension and compute per-group stats.
 *
 * Sorted by closed-trade count desc, then net PnL desc, so the most
 * practiced (and most profitable) groups float to the top. Groups are
 * only interesting when there's a sample; the UI can dim tiny ones.
 */
export function breakdown(
  trades: TradeRow[],
  dimension: BreakdownDimension,
): BreakdownGroup[] {
  const buckets = new Map<string, TradeRow[]>();
  for (const t of trades) {
    const raw = valueOf(t, dimension);
    const key = raw && raw.trim() !== "" ? raw.trim() : NO_VALUE;
    const list = buckets.get(key);
    if (list) list.push(t);
    else buckets.set(key, [t]);
  }

  const groups: BreakdownGroup[] = [];
  for (const [key, rows] of buckets) {
    let closed = 0;
    let winners = 0;
    let losers = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let rSum = 0;
    let rCount = 0;

    for (const t of rows) {
      if (t.pnl != null && Number.isFinite(t.pnl)) {
        closed += 1;
        if (t.pnl > 0) {
          winners += 1;
          grossProfit += t.pnl;
        } else {
          losers += 1;
          grossLoss += t.pnl;
        }
      }
      if (t.r_multiple != null && Number.isFinite(t.r_multiple)) {
        rSum += t.r_multiple;
        rCount += 1;
      }
    }

    groups.push({
      key,
      total: rows.length,
      closed,
      winners,
      losers,
      winRate: closed > 0 ? winners / closed : 0,
      netPnl: grossProfit + grossLoss,
      profitFactor:
        losers > 0 && grossProfit > 0
          ? grossProfit / Math.abs(grossLoss)
          : null,
      avgR: rCount > 0 ? rSum / rCount : null,
    });
  }

  return groups.sort((a, b) => {
    if (b.closed !== a.closed) return b.closed - a.closed;
    return b.netPnl - a.netPnl;
  });
}

/**
 * The headline insight for a dimension: best and worst group by avg R,
 * considering only groups with at least `minTrades` closed trades that
 * have R data (small samples are noise). Returns null when no group
 * qualifies.
 */
export function breakdownInsight(
  groups: BreakdownGroup[],
  minTrades = 3,
): { best: BreakdownGroup; worst: BreakdownGroup } | null {
  const qualified = groups.filter(
    (g) => g.avgR != null && g.winners + g.losers >= minTrades,
  );
  if (qualified.length < 2) return null;
  const sorted = [...qualified].sort((a, b) => (b.avgR ?? 0) - (a.avgR ?? 0));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (best === worst) return null;
  return { best, worst };
}
