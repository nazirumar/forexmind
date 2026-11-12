/**
 * Trade journal analytics - pure functions that turn raw TradeRow[]
 * into chart-ready aggregations.
 *
 * Everything here is PURE: takes trades in, returns derived data out.
 * No I/O, no dates beyond what's in the rows, no randomness. This
 * makes them trivial to unit-test and safe to call from both server
 * and client code (the analytics-panel.tsx component recomputes these
 * client-side whenever the filter changes).
 *
 * Conventions:
 *  - Open trades (no closed_at / null pnl) are EXCLUDED from most
 *    analytics because they don't have a realized outcome yet.
 *  - Equity / drawdown series are ordered by closed_at ascending.
 *  - All money values are account-currency (USD) - same convention
 *    as the rest of the app.
 */
import type { TradeRow, Session } from "@/lib/trades/schema";

// ---------------------------------------------------------------------------
// Per-pair breakdown
// ---------------------------------------------------------------------------

export type PairStat = {
  pair: string;
  total: number;
  winners: number;
  losers: number;
  /** Winners / total. 0 when no trades. */
  winRate: number;
  /** Sum of pnl. */
  netPnl: number;
  /** Average pnl per trade. */
  avgPnl: number;
};

/**
 * Group closed trades by pair, compute per-pair stats.
 *
 * Returns an array sorted by net PnL descending (best pair first).
 * Pure.
 */
export function perPairStats(trades: TradeRow[]): PairStat[] {
  const groups = new Map<string, TradeRow[]>();
  for (const t of trades) {
    if (t.pnl == null || !Number.isFinite(t.pnl)) continue;
    const arr = groups.get(t.pair) ?? [];
    arr.push(t);
    groups.set(t.pair, arr);
  }

  const out: PairStat[] = [];
  for (const [pair, rows] of groups) {
    let winners = 0;
    let losers = 0;
    let net = 0;
    for (const t of rows) {
      net += t.pnl as number;
      if ((t.pnl as number) > 0) winners += 1;
      else losers += 1;
    }
    out.push({
      pair,
      total: rows.length,
      winners,
      losers,
      winRate: rows.length > 0 ? winners / rows.length : 0,
      netPnl: net,
      avgPnl: rows.length > 0 ? net / rows.length : 0,
    });
  }

  out.sort((a, b) => b.netPnl - a.netPnl);
  return out;
}

// ---------------------------------------------------------------------------
// Per-session breakdown
// ---------------------------------------------------------------------------

export type SessionStat = {
  session: Session | "unspecified";
  total: number;
  winners: number;
  losers: number;
  winRate: number;
  netPnl: number;
};

/**
 * Group closed trades by trading session.
 *
 * Trades with `session == null` go into the "unspecified" bucket so
 * they're still visible (the user may want to know they forgot to
 * tag those).
 *
 * Returns array sorted by net PnL descending.
 * Pure.
 */
export function perSessionStats(trades: TradeRow[]): SessionStat[] {
  const groups = new Map<string, TradeRow[]>();
  for (const t of trades) {
    if (t.pnl == null || !Number.isFinite(t.pnl)) continue;
    const key = (t.session ?? "unspecified") as string;
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  const out: SessionStat[] = [];
  for (const [sessionStr, rows] of groups) {
    let winners = 0;
    let losers = 0;
    let net = 0;
    for (const t of rows) {
      net += t.pnl as number;
      if ((t.pnl as number) > 0) winners += 1;
      else losers += 1;
    }
    out.push({
      session: sessionStr as Session | "unspecified",
      total: rows.length,
      winners,
      losers,
      winRate: rows.length > 0 ? winners / rows.length : 0,
      netPnl: net,
    });
  }

  // Stable display order: known sessions first, then unspecified
  const knownOrder: Session[] = ["asian", "london", "newyork", "overlap"];
  out.sort((a, b) => {
    const ai = knownOrder.indexOf(a.session as Session);
    const bi = knownOrder.indexOf(b.session as Session);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return b.netPnl - a.netPnl;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Per-tag breakdown (Phase 18)
// ---------------------------------------------------------------------------

export type TagStat = {
  tag: string;
  total: number;
  winners: number;
  losers: number;
  /** Winners / total. 0 when no closed trades carry this tag. */
  winRate: number;
  /** Sum of pnl across all closed trades carrying this tag. */
  netPnl: number;
  /** Average pnl per closed trade carrying this tag. */
  avgPnl: number;
};

/**
 * Group closed trades by tag.
 *
 * A trade with multiple tags contributes to every tag's bucket - e.g.
 * a winning trade tagged ["fomc", "breakout"] counts once in "fomc"
 * and once in "breakout". The sum of `total` across buckets can
 * therefore exceed the input trade count.
 *
 * Trades with no tags (or null pnl / open trades) are skipped.
 *
 * Returns an array sorted by total trades descending (the tags the
 * user uses most appear first), with net PnL as a tiebreaker. Pure.
 */
export function perTagStats(trades: TradeRow[]): TagStat[] {
  const groups = new Map<string, TradeRow[]>();
  for (const t of trades) {
    if (t.pnl == null || !Number.isFinite(t.pnl)) continue;
    const tags = t.tags ?? [];
    if (tags.length === 0) continue;
    for (const tag of tags) {
      if (typeof tag !== "string" || tag === "") continue;
      const arr = groups.get(tag) ?? [];
      arr.push(t);
      groups.set(tag, arr);
    }
  }

  const out: TagStat[] = [];
  for (const [tag, rows] of groups) {
    let winners = 0;
    let losers = 0;
    let net = 0;
    for (const t of rows) {
      net += t.pnl as number;
      if ((t.pnl as number) > 0) winners += 1;
      else losers += 1;
    }
    out.push({
      tag,
      total: rows.length,
      winners,
      losers,
      winRate: rows.length > 0 ? winners / rows.length : 0,
      netPnl: net,
      avgPnl: rows.length > 0 ? net / rows.length : 0,
    });
  }

  // Most-used tags first, then by net PnL descending.
  out.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return b.netPnl - a.netPnl;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Drawdown series
// ---------------------------------------------------------------------------

export type DrawdownPoint = {
  /** ISO string of the trade's closed_at. */
  at: string;
  /** Equity at this point (running sum of pnl). */
  equity: number;
  /** Peak equity seen so far (up to and including this point). */
  peak: number;
  /** Drawdown from peak in account currency. Always <= 0. */
  drawdown: number;
  /** Drawdown from peak as a percentage. 0 if peak is 0. */
  drawdownPct: number;
};

/**
 * Compute the running drawdown series for the equity curve.
 *
 *  - Sort closed trades by closed_at ascending.
 *  - Compute running equity = sum of pnl up to this point.
 *  - Track running peak = max(equity seen so far).
 *  - drawdown = equity - peak (always <= 0).
 *  - drawdownPct = drawdown / peak * 100 (0 when peak <= 0).
 *
 * The first point is the baseline (equity 0, peak 0, no drawdown).
 * Pure.
 */
export function drawdownSeries(trades: TradeRow[]): DrawdownPoint[] {
  const closed = trades
    .filter((t) => t.closed_at != null && t.pnl != null && Number.isFinite(t.pnl))
    .sort((a, b) => {
      const ta = Date.parse(a.closed_at as string);
      const tb = Date.parse(b.closed_at as string);
      return ta - tb;
    });

  if (closed.length === 0) return [];

  const out: DrawdownPoint[] = [];
  let equity = 0;
  let peak = 0;

  for (const t of closed) {
    equity += t.pnl as number;
    peak = Math.max(peak, equity);
    const drawdown = equity - peak; // <= 0
    const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    out.push({
      at: t.closed_at as string,
      equity,
      peak,
      drawdown,
      drawdownPct,
    });
  }
  return out;
}

/**
 * Maximum drawdown across the whole series (most-negative drawdownPct).
 *
 * Returns { value, pct, at } where:
 *  - value is the worst equity-vs-peak gap (negative or 0)
 *  - pct is the worst percentage drawdown (negative or 0)
 *  - at is the ISO timestamp of the worst point
 *
 * Returns null when there are no closed trades. Pure.
 */
export function maxDrawdown(
  trades: TradeRow[],
): { value: number; pct: number; at: string } | null {
  const series = drawdownSeries(trades);
  if (series.length === 0) return null;

  let worst = series[0]!;
  for (const p of series) {
    if (p.drawdownPct < worst.drawdownPct) worst = p;
  }
  return {
    value: worst.drawdown,
    pct: worst.drawdownPct,
    at: worst.at,
  };
}

// ---------------------------------------------------------------------------
// P&L distribution histogram
// ---------------------------------------------------------------------------

export type PnlBucket = {
  /** Lower bound of the bucket (inclusive). */
  from: number;
  /** Upper bound of the bucket (exclusive for all but the last). */
  to: number;
  /** Center of the bucket - useful for bar chart x-axis labels. */
  label: string;
  /** Number of trades in this bucket. */
  count: number;
};

/**
 * Bucket closed-trade PnLs into a histogram.
 *
 *  - Bucket width is a "nice" round number derived from the data range
 *    (e.g. $50, $100, $200, $500, $1000). Falls back to $50 when there
 *    is no data range.
 *  - Always returns an odd number of buckets centered on 0, so the
 *    middle bucket is always "around breakeven".
 *  - The last bucket is inclusive of its upper bound.
 *
 * Pure.
 */
export function pnlDistribution(
  trades: TradeRow[],
  bucketSize?: number,
): PnlBucket[] {
  const pnls = trades
    .filter((t) => t.pnl != null && Number.isFinite(t.pnl))
    .map((t) => t.pnl as number);
  if (pnls.length === 0) return [];

  const min = Math.min(...pnls);
  const max = Math.max(...pnls);

  // Pick a bucket size: explicit, or derived from the range.
  let size: number;
  if (bucketSize != null && bucketSize > 0) {
    size = bucketSize;
  } else {
    const range = max - min;
    // Aim for 7-11 buckets.
    const candidates = [25, 50, 100, 200, 500, 1000, 2000, 5000];
    size = candidates.find((c) => range / c <= 10) ?? 1000;
  }

  // Compute bucket boundaries so 0 falls on a bucket boundary.
  // Edge case: when min == max (all trades same PnL), we expand the
  // range by one bucket in each direction so there's something to show.
  let lowestFrom = Math.floor(min / size) * size;
  let highestTo = Math.ceil(max / size) * size;
  if (lowestFrom === highestTo) {
    lowestFrom -= size;
    highestTo += size;
  }

  const buckets: PnlBucket[] = [];
  for (let from = lowestFrom; from < highestTo; from += size) {
    const to = from + size;
    const count = pnls.filter((p) =>
      from <= p && (p < to || (to === highestTo && p <= to)),
    ).length;
    buckets.push({
      from,
      to,
      label: formatBucketLabel(from, to, size),
      count,
    });
  }
  return buckets;
}

function formatBucketLabel(from: number, to: number, size: number): string {
  // For small buckets, show $from-$to; for large ones, just the from.
  if (size <= 100) return `$${from}`;
  if (from === 0) return "$0";
  if (from < 0) return `-$${Math.abs(from)}`;
  return `$${from}`;
}

// ---------------------------------------------------------------------------
// Per-weekday breakdown
// ---------------------------------------------------------------------------

export type WeekdayStat = {
  /** 0 = Sunday ... 6 = Saturday (JS Date.getDay convention). */
  day: number;
  /** Display name. */
  label: string;
  total: number;
  winners: number;
  losers: number;
  winRate: number;
  netPnl: number;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Group closed trades by the weekday they were CLOSED on.
 *
 * Useful for spotting "I lose on Mondays" patterns. Returns 7 entries
 * (Sun..Sat) in day order, even for weekdays with no trades (those
 * have total=0). Pure.
 */
export function perWeekdayStats(trades: TradeRow[]): WeekdayStat[] {
  const buckets: WeekdayStat[] = WEEKDAY_LABELS.map((label, day) => ({
    day,
    label,
    total: 0,
    winners: 0,
    losers: 0,
    winRate: 0,
    netPnl: 0,
  }));

  for (const t of trades) {
    if (t.pnl == null || !Number.isFinite(t.pnl)) continue;
    if (t.closed_at == null) continue;
    const d = new Date(t.closed_at);
    if (Number.isNaN(d.getTime())) continue;
    const day = d.getDay();
    const b = buckets[day]!;
    b.total += 1;
    b.netPnl += t.pnl;
    if ((t.pnl as number) > 0) b.winners += 1;
    else b.losers += 1;
  }

  for (const b of buckets) {
    b.winRate = b.total > 0 ? b.winners / b.total : 0;
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Summary numbers used in the analytics header
// ---------------------------------------------------------------------------

export type AnalyticsSummary = {
  /** Best-performing pair (highest net PnL). null when no closed trades. */
  bestPair: { pair: string; netPnl: number } | null;
  /** Worst-performing pair (lowest net PnL). null when no closed trades. */
  worstPair: { pair: string; netPnl: number } | null;
  /** Maximum drawdown across the whole series. null when no closed trades. */
  maxDrawdown: { value: number; pct: number; at: string } | null;
  /** Longest streak of consecutive winning trades. 0 when no winners. */
  longestWinStreak: number;
  /** Longest streak of consecutive losing trades. 0 when no losers. */
  longestLossStreak: number;
  /** Average holding time in minutes for closed trades with both timestamps. */
  avgHoldMinutes: number | null;
  /** Number of trades used to compute these stats. */
  closedCount: number;
};

/**
 * Compute the headline analytics summary used at the top of the panel.
 * Pure.
 */
export function analyticsSummary(trades: TradeRow[]): AnalyticsSummary {
  const pairs = perPairStats(trades);
  const dd = maxDrawdown(trades);
  const closed = trades
    .filter((t) => t.pnl != null && Number.isFinite(t.pnl))
    .sort((a, b) => {
      const ta = Date.parse(a.closed_at ?? "");
      const tb = Date.parse(b.closed_at ?? "");
      return ta - tb;
    });

  // Streaks
  let longestWin = 0;
  let longestLoss = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const t of closed) {
    if ((t.pnl as number) > 0) {
      curWin += 1;
      curLoss = 0;
      longestWin = Math.max(longestWin, curWin);
    } else {
      curLoss += 1;
      curWin = 0;
      longestLoss = Math.max(longestLoss, curLoss);
    }
  }

  // Average holding time
  let holdSum = 0;
  let holdCount = 0;
  for (const t of closed) {
    if (!t.opened_at || !t.closed_at) continue;
    const o = Date.parse(t.opened_at);
    const c = Date.parse(t.closed_at);
    if (Number.isNaN(o) || Number.isNaN(c) || c < o) continue;
    holdSum += (c - o) / 60000; // ms -> minutes
    holdCount += 1;
  }
  const avgHoldMinutes = holdCount > 0 ? holdSum / holdCount : null;

  return {
    bestPair: pairs[0] ? { pair: pairs[0].pair, netPnl: pairs[0].netPnl } : null,
    worstPair: pairs.length > 0
      ? { pair: pairs[pairs.length - 1]!.pair, netPnl: pairs[pairs.length - 1]!.netPnl }
      : null,
    maxDrawdown: dd,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    avgHoldMinutes,
    closedCount: closed.length,
  };
}
