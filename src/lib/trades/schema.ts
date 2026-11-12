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

/** Chart timeframes offered in the journal + analytics. */
export const TIMEFRAMES = [
  "M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1",
] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/**
 * Self-tagged execution mistake types. Used by the psychology analytics
 * to surface a trader's recurring leak (e.g. "you moved your stop on
 * 40% of losing trades"). "none" is the default for clean trades.
 */
export const MISTAKE_TYPES = [
  "none",
  "moved_stop",
  "oversized",
  "chased_entry",
  "early_exit",
  "late_entry",
  "revenge",
  "no_stop",
] as const;
export type MistakeType = (typeof MISTAKE_TYPES)[number];

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
// Tags
// ---------------------------------------------------------------------------

/**
 * Hard caps on user-defined trade tags. Enforced in `normalizeTags`
 * (and mirrored by the DB migration's comment in supabase/schema.sql).
 *
 *  - MAX_TAGS: a trade can carry at most this many labels. Past this
 *    the user is just adding noise; analytics group-by-tag becomes
 *    meaningless with one tag per trade.
 *  - MAX_TAG_LEN: keeps tags readable in the table row and prevents
 *    a tag from being a paragraph.
 */
export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 30;

/**
 * Slugify a single tag value.
 *
 *  - Lowercase.
 *  - Trim leading / trailing whitespace.
 *  - Replace any run of whitespace or disallowed chars with a single
 *    dash. Allowed chars: letters, digits, dash, underscore.
 *  - Collapse repeated dashes.
 *  - Drop empty results.
 *
 * "FOMC 2026" -> "fomc-2026"; "trend_follow!" -> "trend_follow"
 *   (underscore is allowed; "!" becomes a trailing dash, then trimmed);
 * "  breakout  " -> "breakout".
 *
 * Pure. Exported for unit tests.
 */
export function slugifyTag(raw: string): string {
  if (typeof raw !== "string") return "";
  const lower = raw.trim().toLowerCase();
  if (lower === "") return "";
  // Replace any char that isn't [a-z0-9_-] with a dash.
  const slug = lower.replace(/[^a-z0-9_-]+/g, "-");
  // Trim leading/trailing dashes, collapse runs.
  return slug.replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

/**
 * Normalize a free-form tags input into a clean, deduped array.
 *
 * Accepts:
 *  - string[] (already split) - each element is slugified.
 *  - string (comma, space, or newline separated) - split then slugified.
 *  - null / undefined / "" - returns [].
 *
 * Truncates to MAX_TAGS, drops empties and duplicates (case-insensitive
 * after slugify, so "FOMC" and "fomc" are the same tag).
 *
 * Pure. Exported for unit tests and reused by the CSV import path.
 */
export function normalizeTags(input: unknown): string[] {
  if (input == null) return [];
  // We carry `unknown[]` here so the loop below can filter non-string
  // elements (a malformed payload might contain numbers / nulls).
  let parts: unknown[] = [];
  if (Array.isArray(input)) {
    parts = input;
  } else if (typeof input === "string") {
    if (input.trim() === "") return [];
    // Split on commas, newlines, or whitespace runs. The user might
    // type "fomc, breakout, trend" or "fomc breakout trend".
    parts = input.split(/[,\n\r]|\s+/).filter((s) => s.trim() !== "");
  } else {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  // Drop non-string array elements outright; coercing 42 -> "42" or
  // null -> "null" would create junk tags from a malformed payload.
  for (const raw of parts) {
    if (typeof raw !== "string") continue;
    const slug = slugifyTag(raw);
    if (slug === "") continue;
    if (slug.length > MAX_TAG_LEN) {
      // Truncate rather than reject - the user clearly meant something,
      // and a hard reject on a too-long tag is more annoying than helpful.
      const truncated = slug.slice(0, MAX_TAG_LEN).replace(/-+$/g, "");
      if (truncated === "" || seen.has(truncated)) continue;
      seen.add(truncated);
      out.push(truncated);
      continue;
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

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
    error: () => ({ message: "Direction must be buy or sell." }),
  }),
  entry_price: z
    .number({ error: () => ({ message: "Entry price must be a number." }) })
    .positive("Entry price must be greater than zero.")
    .max(1_000_000, "Entry price looks too large."),
  exit_price: z
    .number()
    .positive("Exit price must be greater than zero.")
    .max(1_000_000, "Exit price looks too large.")
    .optional()
    .nullable(),
  stop_loss: z
    .number({ error: () => ({ message: "Stop loss must be a number." }) })
    .positive("Stop loss must be greater than zero.")
    .max(1_000_000, "Stop loss looks too large."),
  take_profit: z
    .number()
    .positive("Take profit must be greater than zero.")
    .max(1_000_000, "Take profit looks too large.")
    .optional()
    .nullable(),
  lot_size: z
    .number({ error: () => ({ message: "Lot size must be a number." }) })
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
  /**
   * User-defined tags for this trade. Accepts a string (comma/space
   * separated), a string[], or null/undefined. Always normalized to a
   * clean string[] via `normalizeTags` (slugified, deduped, capped at
   * MAX_TAGS). Empty array when no tags supplied.
   */
  tags: z
    .preprocess((v) => normalizeTags(v), z.array(z.string().min(1).max(MAX_TAG_LEN)))
    .default([]),
  /**
   * ---- Risk-management fields (Feature 1) ----
   * All optional: a trade can be logged without them, but when present
   * they power R-multiple analytics, expectancy and the equity-in-R
   * curve. risk_amount is the $ at risk if SL is hit; risk_pct is that
   * same figure expressed as a % of account_balance.
   */
  account_balance: z
    .number()
    .finite()
    .min(0, "Account balance cannot be negative.")
    .max(1_000_000_000, "Account balance looks too large.")
    .optional()
    .nullable()
    .transform((s) => (s === null ? null : s)),
  risk_pct: z
    .number()
    .finite()
    .min(0, "Risk % cannot be negative.")
    .max(100, "Risk % cannot exceed 100.")
    .optional()
    .nullable()
    .transform((s) => (s === null ? null : s)),
  risk_amount: z
    .number()
    .finite()
    .min(0, "Risk amount cannot be negative.")
    .max(1_000_000_000, "Risk amount looks too large.")
    .optional()
    .nullable()
    .transform((s) => (s === null ? null : s)),
  timeframe: z
    .preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.enum(TIMEFRAMES).nullable(),
    )
    .optional(),
  /**
   * ---- Psychology field (Feature 2) ----
   * Self-tagged execution mistake. "none" or null = clean trade.
   */
  mistake_type: z
    .preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.enum(MISTAKE_TYPES).nullable(),
    )
    .optional(),
  /**
   * ---- Chart screenshots (Feature 2) ----
   * Public URLs into the `trade-screenshots` Storage bucket. The path
   * is `<user_id>/<trade_id>-before.png`. Nullable until uploaded.
   */
  screenshot_url: z
    .string()
    .trim()
    .max(2000, "Screenshot URL is too long.")
    .optional()
    .nullable()
    .transform((s) => (s === "" || s == null ? null : s)),
  screenshot_after_url: z
    .string()
    .trim()
    .max(2000, "Screenshot URL is too long.")
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
  /**
   * Tags as stored in the DB (text[] NOT NULL DEFAULT '{}').
   * Older rows that predate the tags column are read back as [] by
   * the queries layer's COALESCE; the schema itself just enforces
   * "array of strings" here.
   */
  tags: z.array(z.string()).default([]),
  // Risk-management fields (Feature 1). Nullable for older rows.
  account_balance: z.number().nullable().optional(),
  risk_pct: z.number().nullable().optional(),
  risk_amount: z.number().nullable().optional(),
  /** Server-computed on close: pnl / risk_amount. Null until both known. */
  r_multiple: z.number().nullable().optional(),
  timeframe: z.enum(TIMEFRAMES).nullable().optional(),
  // Psychology + screenshots (Feature 2).
  mistake_type: z.enum(MISTAKE_TYPES).nullable().optional(),
  screenshot_url: z.string().nullable().optional(),
  screenshot_after_url: z.string().nullable().optional(),
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
// Multi-filter (Phase 18)
// ---------------------------------------------------------------------------

/**
 * Outcome filter dimension. Maps to a predicate over a TradeRow:
 *  - "all"       : no outcome filter
 *  - "win"       : closed trade with pnl > 0
 *  - "loss"      : closed trade with pnl <= 0
 *  - "open"      : trade with no closed_at (still running) OR null pnl
 *  - "breakeven" : closed trade with pnl === 0
 *
 * "loss" includes breakeven by convention (matches the win-rate
 * definition in computeStats: pnl <= 0 is a non-winner).
 */
export type OutcomeFilter = "all" | "win" | "loss" | "open" | "breakeven";
export const OUTCOME_FILTERS: readonly OutcomeFilter[] = [
  "all",
  "win",
  "loss",
  "open",
  "breakeven",
] as const;

/**
 * Structured filter for the trades list. Every field is optional;
 * `none`/`"all"` sentinels mean "no filter on this dimension".
 *
 *  - pair:       one of PAIRS, or null/"all" for no filter.
 *  - direction:  "buy" | "sell" | "all".
 *  - tag:        a single slugified tag (matches if trade.tags includes it).
 *  - session:    one of SESSIONS, or "all".
 *  - strategy:   exact match (case-insensitive) against trade.strategy.
 *  - outcome:    see OutcomeFilter.
 *  - followedPlan: true = only plan-followed trades; false = only
 *                  plan-broken trades; null = no filter.
 *  - openedFrom / openedTo: ISO date bounds on opened_at (inclusive).
 *
 * This is the shape the API layer parses query params into and the
 * shape the queries layer applies to the Supabase builder. The pure
 * `applyTradeFilter()` below mirrors the same logic client-side so
 * the journal UI can filter a loaded page without a refetch.
 */
export type TradeFilter = {
  pair: string | null;
  direction: "buy" | "sell" | "all";
  tag: string | null;
  session: Session | "all";
  strategy: string | null;
  outcome: OutcomeFilter;
  followedPlan: boolean | null;
  openedFrom: string | null;
  openedTo: string | null;
};

/** A filter with every dimension set to "no filter". */
export const EMPTY_FILTER: TradeFilter = {
  pair: null,
  direction: "all",
  tag: null,
  session: "all",
  strategy: null,
  outcome: "all",
  followedPlan: null,
  openedFrom: null,
  openedTo: null,
};

/** True if every dimension is at its no-filter default. */
export function isFilterEmpty(f: TradeFilter): boolean {
  return (
    f.pair === null &&
    f.direction === "all" &&
    f.tag === null &&
    f.session === "all" &&
    f.strategy === null &&
    f.outcome === "all" &&
    f.followedPlan === null &&
    f.openedFrom === null &&
    f.openedTo === null
  );
}

/**
 * Parse a URLSearchParams (or a plain string->string record) into a
 * TradeFilter. Unknown / invalid values are dropped silently rather
 * than throwing - the caller already authenticated and we don't want
 * a typo in the query string to 400 the whole list endpoint.
 *
 * Pure. Used by the /api/trades GET handler.
 */
export function parseTradeFilter(
  input: URLSearchParams | Record<string, string | string[] | null | undefined>,
): TradeFilter {
  const get = (k: string): string | null => {
    if (input instanceof URLSearchParams) {
      return input.get(k);
    }
    const v = input[k];
    if (v == null) return null;
    return Array.isArray(v) ? (v[0] ?? null) : v;
  };

  const pairRaw = get("pair");
  const pair =
    pairRaw && (PAIRS as readonly string[]).includes(normalizePair(pairRaw))
      ? normalizePair(pairRaw)
      : null;

  const dirRaw = (get("direction") ?? "all").toLowerCase();
  const direction: TradeFilter["direction"] =
    dirRaw === "buy" || dirRaw === "sell" ? dirRaw : "all";

  const tagRaw = get("tag");
  const tag = tagRaw ? slugifyTag(tagRaw) || null : null;

  const sessRaw = (get("session") ?? "all").toLowerCase();
  const session: TradeFilter["session"] = (
    SESSIONS as readonly string[]
  ).includes(sessRaw)
    ? (sessRaw as Session)
    : "all";

  const stratRaw = get("strategy");
  const strategy = stratRaw && stratRaw.trim() !== "" ? stratRaw.trim() : null;

  const outcomeRaw = (get("outcome") ?? "all").toLowerCase();
  const outcome: OutcomeFilter = (
    OUTCOME_FILTERS as readonly string[]
  ).includes(outcomeRaw)
    ? (outcomeRaw as OutcomeFilter)
    : "all";

  const fpRaw = get("followed_plan");
  let followedPlan: boolean | null = null;
  if (fpRaw != null) {
    const lower = fpRaw.toLowerCase();
    if (["true", "1", "yes", "y"].includes(lower)) followedPlan = true;
    else if (["false", "0", "no", "n"].includes(lower)) followedPlan = false;
  }

  const openedFromRaw = get("opened_from");
  const openedFrom =
    openedFromRaw && !Number.isNaN(Date.parse(openedFromRaw))
      ? openedFromRaw
      : null;

  const openedToRaw = get("opened_to");
  const openedTo =
    openedToRaw && !Number.isNaN(Date.parse(openedToRaw)) ? openedToRaw : null;

  return {
    pair,
    direction,
    tag,
    session,
    strategy,
    outcome,
    followedPlan,
    openedFrom,
    openedTo,
  };
}

/**
 * Apply a TradeFilter to a single TradeRow. Pure predicate.
 *
 * Used by the journal UI for instant client-side filtering over a
 * loaded page. The server-side query builder mirrors the same rules
 * so a server-filtered fetch and a client-filtered page agree.
 */
export function matchesFilter(t: TradeRow, f: TradeFilter): boolean {
  if (f.pair !== null && t.pair !== f.pair) return false;
  if (f.direction !== "all" && t.direction !== f.direction) return false;
  if (f.tag !== null && !(t.tags ?? []).includes(f.tag)) return false;
  if (f.session !== "all" && t.session !== f.session) return false;
  if (f.strategy !== null) {
    if (
      t.strategy == null ||
      t.strategy.toLowerCase() !== f.strategy.toLowerCase()
    ) {
      return false;
    }
  }
  if (f.followedPlan !== null && t.followed_plan !== f.followedPlan) {
    return false;
  }
  if (f.openedFrom !== null || f.openedTo !== null) {
    const opened = Date.parse(t.opened_at);
    if (Number.isNaN(opened)) return false;
    if (f.openedFrom !== null && opened < Date.parse(f.openedFrom)) return false;
    if (f.openedTo !== null && opened > Date.parse(f.openedTo)) return false;
  }
  switch (f.outcome) {
    case "all":
      break;
    case "win":
      if (t.pnl == null || t.pnl <= 0) return false;
      break;
    case "loss":
      // Closed non-winner (pnl <= 0). Open trades don't match.
      if (t.pnl == null || t.pnl > 0) return false;
      break;
    case "open":
      // No closed_at OR no pnl yet.
      if (t.closed_at != null && t.pnl != null) return false;
      break;
    case "breakeven":
      if (t.pnl !== 0) return false;
      break;
  }
  return true;
}

/**
 * Apply a TradeFilter to a list. Pure: returns a new array.
 */
export function applyTradeFilter(
  trades: TradeRow[],
  f: TradeFilter,
): TradeRow[] {
  if (isFilterEmpty(f)) return trades;
  return trades.filter((t) => matchesFilter(t, f));
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
