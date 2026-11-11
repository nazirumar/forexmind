/**
 * Trade journal - domain schema, types and pure helpers.
 *
 * This module is the single source of truth for what a "trade" looks
 * like across the app: the form, the API routes, the database queries
 * and the stats. Keep it free of any I/O so it can be imported from
 * both server and client code without pulling in `next/headers` etc.
 *
 * The zod schemas mirror the columns of `public.trades` in
 * `supabase/schema.sql`. Any change to the DB shape must be reflected
 * here (and vice versa).
 */
import { z } from "zod";
import { normalizePair } from "@/lib/risk";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const DIRECTIONS = ["buy", "sell"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const SESSIONS = ["asian", "london", "newyork", "overlap"] as const;
export type Session = (typeof SESSIONS)[number];

/** Forex pairs offered in the journal dropdown. Matches the risk
 *  calculator so a user thinks about one list across the app. */
export const PAIRS = [
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
export type Pair = (typeof PAIRS)[number];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Base object schema (without the cross-field refinement) so we can
 * safely derive both the create and the partial-update schemas from
 * the same field definitions. Zod v4 disallows `.partial()` on
 * refined schemas, hence the split.
 */
const tradeBaseFields = {
  pair: z
    .string()
    .trim()
    .min(4, "Pair is required.")
    .transform((s) => normalizePair(s))
    .refine((p) => (PAIRS as readonly string[]).includes(p), {
      message: "Unsupported pair. Pick one from the list.",
    }),
  direction: z.enum(DIRECTIONS, {
    errorMap: () => ({ message: "Direction must be buy or sell." }),
  }),
  entry_price: z
    .number({ errorMap: () => ({ message: "Entry price must be a number." }) })
    .positive("Entry price must be greater than zero.")
    .max(1_000_000, "Entry price looks too large."),
  exit_price: z
    .number()
    .positive("Exit price must be greater than zero.")
    .max(1_000_000, "Exit price looks too large.")
    .optional()
    .nullable(),
  stop_loss: z
    .number({ errorMap: () => ({ message: "Stop loss must be a number." }) })
    .positive("Stop loss must be greater than zero.")
    .max(1_000_000, "Stop loss looks too large."),
  take_profit: z
    .number()
    .positive("Take profit must be greater than zero.")
    .max(1_000_000, "Take profit looks too large.")
    .optional()
    .nullable(),
  lot_size: z
    .number({ errorMap: () => ({ message: "Lot size must be a number." }) })
    .positive("Lot size must be greater than zero.")
    .max(10_000, "Lot size looks too large."),
  opened_at: z
    .string()
    .min(1, "Open time is required.")
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "Open time is not a valid ISO date.",
    }),
  closed_at: z
    .string()
    .refine((s) => s === "" || !Number.isNaN(Date.parse(s)), {
      message: "Close time is not a valid ISO date.",
    })
    .optional()
    .nullable()
    .transform((s) => (s === "" || s == null ? null : s)),
  pnl: z
    .number()
    .finite()
    .max(1_000_000_000, "PnL looks too large.")
    .optional()
    .nullable(),
  strategy: z
    .string()
    .trim()
    .max(120, "Strategy: keep it under 120 characters.")
    .optional()
    .nullable()
    .transform((s) => (s === "" || s == null ? null : s)),
  session: z.enum(SESSIONS).optional().nullable(),
  emotion: z
    .string()
    .trim()
    .max(60, "Emotion: keep it under 60 characters.")
    .optional()
    .nullable()
    .transform((s) => (s === "" || s == null ? null : s)),
  followed_plan: z.boolean().default(true),
  notes: z
    .string()
    .trim()
    .max(4000, "Notes: keep it under 4000 characters.")
    .optional()
    .nullable()
    .transform((s) => (s === "" || s == null ? null : s)),
};

const tradeBaseObject = z.object(tradeBaseFields);

/**
 * Schema for CREATE. Same columns the SQL table expects on insert,
 * minus the server-set ones (id, user_id, created_at). The cross-
 * field check (closed_at >= opened_at) is layered on top with
 * superRefine so it doesn't interfere with the partial-update schema.
 */
export const tradeCreateSchema = tradeBaseObject.superRefine((val, ctx) => {
  if (val.closed_at && val.opened_at) {
    const o = Date.parse(val.opened_at);
    const c = Date.parse(val.closed_at);
    if (c < o) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closed_at"],
        message: "Close time cannot be before open time.",
      });
    }
  }
  // exit_price present but closed_at absent (or vice versa) is allowed;
  // many journals log exit-price-only. We just don't enforce it.
});

export type TradeCreate = z.infer<typeof tradeCreateSchema>;

/**
 * Schema for UPDATE. All fields optional; id and user_id never come
 * from the client. The cross-field check is re-applied so a partial
 * update that supplies both opened_at and closed_at still gets
 * validated for ordering.
 */
export const tradeUpdateSchema = tradeBaseObject
  .partial()
  .superRefine((val, ctx) => {
    if (val.closed_at && val.opened_at) {
      const o = Date.parse(val.opened_at);
      const c = Date.parse(val.closed_at);
      if (c < o) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["closed_at"],
          message: "Close time cannot be before open time.",
        });
      }
    }
  });
export type TradeUpdate = z.infer<typeof tradeUpdateSchema>;

/**
 * A trade row as it comes back from Supabase. `id`, `user_id` and
 * `created_at` are server-managed; everything else matches the
 * create schema (but is no longer optional where the DB column is
 * NOT NULL).
 */
export const tradeRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  pair: z.string(),
  direction: z.enum(DIRECTIONS),
  entry_price: z.number(),
  exit_price: z.number().nullable(),
  stop_loss: z.number(),
  take_profit: z.number().nullable(),
  lot_size: z.number(),
  opened_at: z.string(),
  closed_at: z.string().nullable(),
  pnl: z.number().nullable(),
  strategy: z.string().nullable(),
  session: z.enum(SESSIONS).nullable(),
  emotion: z.string().nullable(),
  followed_plan: z.boolean(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type TradeRow = z.infer<typeof tradeRowSchema>;

/**
 * Shape of the JSON returned by GET /api/trades (list endpoint).
 * `stats` is computed server-side so the client doesn't have to.
 */
export type TradeListResponse = {
  trades: TradeRow[];
  stats: TradeStats;
  /** Whether the user has more trades than the returned page (always
   *  false for now since we cap at 200; future: real pagination). */
  hasMore: boolean;
};

// ---------------------------------------------------------------------------
// Pure stats helpers
// ---------------------------------------------------------------------------

export type TradeStats = {
  total: number;
  /** Number of closed trades with non-null PnL. */
  closed: number;
  /** Number of closed trades whose PnL > 0. */
  winners: number;
  /** Number of closed trades whose PnL <= 0. */
  losers: number;
  /** Winners / closed, as a fraction in [0, 1]. 0 when no closed trades. */
  winRate: number;
  /** Sum of positive PnLs. */
  grossProfit: number;
  /** Sum of negative PnLs (negative number). */
  grossLoss: number;
  /** grossProfit + grossLoss. */
  netPnl: number;
  /** grossProfit / abs(grossLoss). NaN when no losers. */
  profitFactor: number;
  /** Average PnL per closed trade. 0 when no closed trades. */
  avgPnl: number;
  /** Average PnL of winners. 0 when no winners. */
  avgWin: number;
  /** Average PnL of losers (negative). 0 when no losers. */
  avgLoss: number;
  /** Sum of all lots traded (closed + open). */
  totalLots: number;
  /** Number of trades where followed_plan = false. */
  brokePlanCount: number;
};

/**
 * Compute aggregate stats from a list of trades.
 *
 * Pure function: takes the trade rows as input, returns the stats
 * object. Safe to call from the server (for the API envelope) or
 * from the client (for live filtering).
 *
 * - `closed` trades = those with pnl != null.
 * - `winners` = closed trades with pnl > 0.
 * - `losers` = closed trades with pnl <= 0 (a breakeven pnl of 0
 *   counts as a loser for win-rate purposes; this is the most common
 *   journal convention).
 * - `profitFactor` = sum(wins) / abs(sum(losses)). When there are no
 *   losers, profitFactor is Infinity; we surface that as NaN to keep
 *   JSON.stringify happy and let the UI render "n/a".
 */
export function computeStats(trades: TradeRow[]): TradeStats {
  let closed = 0;
  let winners = 0;
  let losers = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalLots = 0;
  let brokePlanCount = 0;

  for (const t of trades) {
    totalLots += t.lot_size;
    if (!t.followed_plan) brokePlanCount += 1;

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
  }

  const netPnl = grossProfit + grossLoss;
  const winRate = closed > 0 ? winners / closed : 0;
  const avgPnl = closed > 0 ? netPnl / closed : 0;
  const avgWin = winners > 0 ? grossProfit / winners : 0;
  const avgLoss = losers > 0 ? grossLoss / losers : 0;
  // Profit factor: NaN when no losers (so the UI can show "n/a"
  // rather than "Infinity"). Infinity is not valid JSON.
  const profitFactor =
    losers > 0
      ? grossProfit / Math.abs(grossLoss)
      : Number.NaN;

  return {
    total: trades.length,
    closed,
    winners,
    losers,
    winRate,
    grossProfit,
    grossLoss,
    netPnl,
    profitFactor,
    avgPnl,
    avgWin,
    avgLoss,
    totalLots,
    brokePlanCount,
  };
}

/**
 * Build an "equity curve" - the running PnL total ordered by close
 * time. Open trades (no closed_at) are excluded; they don't have a
 * realized PnL yet.
 *
 * Each point is `{ at: ISO-string, equity: number }` starting from 0
 * before the first closed trade. Returned sorted by closed_at asc.
 *
 * Pure: no I/O, deterministic.
 */
export type EquityPoint = { at: string; equity: number };

export function equityCurve(trades: TradeRow[]): EquityPoint[] {
  const closed = trades
    .filter((t) => t.closed_at != null && t.pnl != null && Number.isFinite(t.pnl))
    .sort((a, b) => {
      const ta = Date.parse(a.closed_at as string);
      const tb = Date.parse(b.closed_at as string);
      return ta - tb;
    });

  const out: EquityPoint[] = [{ at: closed[0]?.closed_at ?? new Date(0).toISOString(), equity: 0 }];
  let running = 0;
  for (const t of closed) {
    running += t.pnl as number;
    out.push({ at: t.closed_at as string, equity: running });
  }
  return out;
}

// ---------------------------------------------------------------------------
// UI display helpers
// ---------------------------------------------------------------------------

export function formatPair(pair: string): string {
  const p = normalizePair(pair);
  // EURUSD -> EUR/USD, USDJPY -> USD/JPY, XAUUSD -> XAU/USD
  if (p.length === 6) return `${p.slice(0, 3)}/${p.slice(3)}`;
  return p;
}

export function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * "2h ago" / "3d ago" / "just now". Cheap relative-time formatter
 * so the journal list doesn't need date-fns's full machinery.
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}
