/**
 * R-multiple + risk-analytics (Feature 1: risk foundation).
 *
 * Pure functions that turn TradeRow[] into R-multiple aggregates:
 *  - expectancy (average R per trade)
 *  - R-distribution histogram
 *  - equity curve measured in R (not $)
 *  - daily / weekly loss-limit checks (against trading_goals)
 *
 * R = pnl / risk_amount. Trades without a recorded risk_amount are
 * excluded from R-based aggregates (we can't normalise them). They are
 * still counted in the headline stats (computeStats in schema.ts) so
 * nothing disappears.
 *
 * All money/R values are account-currency-normalised. Pure: no I/O.
 */
import type { TradeRow } from "@/lib/trades/schema";
import { computeRMultiple } from "@/lib/risk";

/** A closed trade with its realized R attached, for downstream charts. */
export type RTrade = {
  id: string;
  pair: string;
  closedAt: string;
  pnl: number;
  riskAmount: number;
  r: number;
};

/**
 * Attach a realized R to every closed trade that has a risk_amount.
 * Trades missing pnl or risk_amount (or with risk_amount <= 0) are
 * dropped. Sorted by closed_at ascending.
 *
 * Pure.
 */
export function withRMultiples(trades: TradeRow[]): RTrade[] {
  const out: RTrade[] = [];
  for (const t of trades) {
    if (t.closed_at == null) continue;
    if (t.pnl == null || !Number.isFinite(t.pnl)) continue;
    const r = computeRMultiple(t.pnl, t.risk_amount);
    if (r == null || !Number.isFinite(r)) continue;
    out.push({
      id: t.id,
      pair: t.pair,
      closedAt: t.closed_at,
      pnl: t.pnl,
      riskAmount: t.risk_amount as number,
      r,
    });
  }
  out.sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  return out;
}

// ---------------------------------------------------------------------------
// Expectancy
// ---------------------------------------------------------------------------

export type Expectancy = {
  /** Average R per trade across the sample. The single most important
   *  number: a positive expectancy means the system is profitable. */
  expectancyR: number;
  /** Average R of winning trades (e.g. +1.8R). */
  avgWinR: number;
  /** Average R of losing trades (e.g. -1.0R). */
  avgLossR: number;
  /** Winners / total (fraction 0..1). */
  winRate: number;
  /** Number of trades in the sample. */
  count: number;
};

/**
 * Compute expectancy (in R) from a list of trades.
 *
 *     expectancyR = (winRate * avgWinR) + (lossRate * avgLossR)
 *
 * A trader with 40% win rate, +2R average win, -1R average loss has
 * expectancy = 0.4*2 + 0.6*(-1) = +0.2R per trade. Positive = profitable.
 *
 * Returns count=0 and zeroes when no trades carry R data. Pure.
 */
export function rExpectancy(trades: TradeRow[]): Expectancy {
  const rs = withRMultiples(trades);
  if (rs.length === 0) {
    return { expectancyR: 0, avgWinR: 0, avgLossR: 0, winRate: 0, count: 0 };
  }
  let wins = 0;
  let losses = 0;
  let winSum = 0;
  let lossSum = 0;
  for (const t of rs) {
    if (t.pnl > 0) {
      wins += 1;
      winSum += t.r;
    } else {
      losses += 1;
      lossSum += t.r;
    }
  }
  const total = rs.length;
  const winRate = wins / total;
  const avgWinR = wins > 0 ? winSum / wins : 0;
  const avgLossR = losses > 0 ? lossSum / losses : 0;
  const expectancyR = winRate * avgWinR + (1 - winRate) * avgLossR;
  return { expectancyR, avgWinR, avgLossR, winRate, count: total };
}

// ---------------------------------------------------------------------------
// R-distribution histogram
// ---------------------------------------------------------------------------

export type RBucket = {
  /** Lower bound (inclusive). Buckets are 0.5R wide centered on 0. */
  from: number;
  to: number;
  label: string;
  count: number;
};

/**
 * Bucket realized R into a 0.5R-wide histogram centered on 0.
 *
 * Buckets run from the most-negative to most-positive R present. The
 * middle bucket always straddles 0 (the breakeven trades). Pure.
 */
export function rDistribution(trades: TradeRow[]): RBucket[] {
  const rs = withRMultiples(trades).map((t) => t.r);
  if (rs.length === 0) return [];

  const min = Math.min(...rs);
  const max = Math.max(...rs);
  const size = 0.5;

  // Align bucket boundaries to multiples of 0.5 so 0 is a boundary.
  let lowestFrom = Math.floor(min / size) * size;
  let highestTo = Math.ceil(max / size) * size;
  if (lowestFrom === highestTo) {
    lowestFrom -= size;
    highestTo += size;
  }

  const buckets: RBucket[] = [];
  for (let from = lowestFrom; from < highestTo; from += size) {
    const to = from + size;
    const count = rs.filter((r) =>
      from <= r && (r < to || (to === highestTo && r <= to)),
    ).length;
    buckets.push({
      from,
      to,
      label: formatRLabel(from, to),
      count,
    });
  }
  return buckets;
}

function formatRLabel(from: number, to: number): string {
  const fmt = (n: number) =>
    `${n > 0 ? "+" : ""}${n.toFixed(1)}R`;
  if (from < 0 && to > 0) return "0R";
  return fmt(from);
}

// ---------------------------------------------------------------------------
// R-equity curve
// ---------------------------------------------------------------------------

export type REquityPoint = { at: string; rEquity: number };

/**
 * Cumulative R over closed trades, ordered by close time. Starts at 0
 * before the first trade. This is the "are you trending up in R?"
 * curve that matters more than the $ equity curve because it is
 * size-independent. Pure.
 */
export function rEquityCurve(trades: TradeRow[]): REquityPoint[] {
  const rs = withRMultiples(trades);
  if (rs.length === 0) return [];
  const out: REquityPoint[] = [{ at: rs[0]!.closedAt, rEquity: 0 }];
  let running = 0;
  for (const t of rs) {
    running += t.r;
    out.push({ at: t.closedAt, rEquity: running });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Headline R stats
// ---------------------------------------------------------------------------

export type RStats = {
  expectancy: Expectancy;
  /** Best single trade in R. null when no R data. */
  bestR: number | null;
  /** Worst single trade in R. null when no R data. */
  worstR: number | null;
  /** Sum of all R = total R earned/lost. */
  totalR: number;
  /** Trades that gained >= +1R (a "full winner"). */
  fullWinners: number;
  /** Trades that lost the full -1R (SL hit, no worse). */
  fullLosers: number;
  /** Trades worse than -1R (moved stop / no stop). */
  blownStops: number;
};

/**
 * Compute the headline R stats for the risk dashboard. Pure.
 */
export function rStats(trades: TradeRow[]): RStats {
  const rs = withRMultiples(trades);
  if (rs.length === 0) {
    return {
      expectancy: rExpectancy(trades),
      bestR: null,
      worstR: null,
      totalR: 0,
      fullWinners: 0,
      fullLosers: 0,
      blownStops: 0,
    };
  }
  let best = rs[0]!.r;
  let worst = rs[0]!.r;
  let total = 0;
  let fullWinners = 0;
  let fullLosers = 0;
  let blownStops = 0;
  for (const t of rs) {
    best = Math.max(best, t.r);
    worst = Math.min(worst, t.r);
    total += t.r;
    if (t.r >= 1) fullWinners += 1;
    if (t.r <= -1 && t.r > -1.5) fullLosers += 1;
    if (t.r < -1) blownStops += 1;
  }
  return {
    expectancy: rExpectancy(trades),
    bestR: best,
    worstR: worst,
    totalR: total,
    fullWinners,
    fullLosers,
    blownStops,
  };
}

// ---------------------------------------------------------------------------
// Daily / weekly loss-limit checks (Feature 1: discipline guard)
// ---------------------------------------------------------------------------

export type LossLimitStatus = {
  /** Trades already closed today (UTC day). */
  todayTrades: number;
  /** Sum of PnL today. */
  todayPnl: number;
  /** Sum of R today (null when no risk_amount recorded today). */
  todayR: number | null;
  /** Trades closed in the current UTC week (Mon-Sun). */
  weekTrades: number;
  /** Sum of PnL this week. */
  weekPnl: number;
  /** True when the daily loss limit is breached (todayPnl <= -limit). */
  dailyLimitHit: boolean;
  /** True when the weekly loss limit is breached. */
  weeklyLimitHit: boolean;
  /** Human-readable warning, or null when all clear. */
  warning: string | null;
};

/**
 * Check the user's recent closed trades against their loss limits.
 *
 * Limits come from trading_goals:
 *  - max_daily_loss_pct: interpreted against the most recent
 *    account_balance seen on a trade (or the profile default_balance).
 *    A limit of 2% on a $10,000 balance = $200 daily loss cap.
 *
 * We do NOT hard-block here — the API route returns this status and the
 * client surfaces a confirm dialog. The trader makes the final call;
 * the tool just makes the risk impossible to ignore.
 *
 * `balanceForPct` is the account balance used to turn the % limit into
 * a $ amount (caller passes the user's current/default balance).
 *
 * Pure except for the use of Date.now() for "today" / "this week".
 */
export function checkLossLimits(
  trades: TradeRow[],
  opts: {
    maxDailyLossPct?: number | null;
    maxTradesPerDay?: number | null;
    balanceForPct?: number | null;
  },
): LossLimitStatus {
  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const dayMs = todayStart.getTime();

  // Week start = Monday 00:00 UTC.
  const weekStart = new Date(dayMs);
  const dow = weekStart.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMon = (dow + 6) % 7; // Mon=0..Sun=6
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMon);
  const weekMs = weekStart.getTime();

  let todayTrades = 0;
  let todayPnl = 0;
  let todayRSum = 0;
  let todayRCount = 0;
  let weekTrades = 0;
  let weekPnl = 0;

  for (const t of trades) {
    if (t.closed_at == null || t.pnl == null || !Number.isFinite(t.pnl)) continue;
    const c = Date.parse(t.closed_at);
    if (Number.isNaN(c)) continue;
    if (c >= dayMs) {
      todayTrades += 1;
      todayPnl += t.pnl;
      const r = computeRMultiple(t.pnl, t.risk_amount);
      if (r != null && Number.isFinite(r)) {
        todayRSum += r;
        todayRCount += 1;
      }
    }
    if (c >= weekMs) {
      weekTrades += 1;
      weekPnl += t.pnl;
    }
  }

  const balance = opts.balanceForPct ?? null;
  const dailyLimit$ =
    opts.maxDailyLossPct != null && balance != null && balance > 0
      ? (opts.maxDailyLossPct / 100) * balance
      : null;

  const dailyLimitHit =
    dailyLimit$ != null && todayPnl <= -dailyLimit$;
  const maxTradesHit =
    opts.maxTradesPerDay != null && todayTrades >= opts.maxTradesPerDay;

  const todayR = todayRCount > 0 ? todayRSum : null;

  let warning: string | null = null;
  if (dailyLimitHit) {
    warning = `Daily loss limit reached: ${formatMoney(todayPnl)} today vs −${formatMoney(dailyLimit$)} limit. Stop trading for the day.`;
  } else if (maxTradesHit) {
    warning = `Max trades/day reached: ${todayTrades} trades today (limit ${opts.maxTradesPerDay}).`;
  } else if (todayR != null && todayR <= -2) {
    warning = `Down ${todayR.toFixed(1)}R today. Consider sitting out the rest of the session.`;
  }

  return {
    todayTrades,
    todayPnl,
    todayR,
    weekTrades,
    weekPnl,
    dailyLimitHit,
    weeklyLimitHit: false,
    warning,
  };
}

function formatMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
