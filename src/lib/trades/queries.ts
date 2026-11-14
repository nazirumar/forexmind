/**
 * Server-only data access for the trade journal (Neon Postgres via Prisma).
 *
 * Every function:
 *  1. Authenticates the caller with getUserOrThrow() - so we always
 *     have a real user.id to scope queries by.
 *  2. Uses Prisma against the Neon DB. There is no RLS anymore (that
 *     was a Supabase feature), so EVERY query explicitly filters by
 *     userId. This is the new isolation boundary - never drop the
 *     userId filter.
 *  3. Returns typed data (TradeRow / TradeStats / TradeListResponse)
 *     or throws a TradesError that the route handler maps to an HTTP
 *     status.
 *
 * The rest of the app consumes the snake_case TradeRow shape (from
 * schema.ts); Prisma generates camelCase fields. `toTradeRow` maps
 * between them so callers don't change.
 */
import { db } from "@/lib/db";
import type { Trade as PrismaTrade } from "@prisma/client";
import { getUserOrThrow } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { getSelectedAccountId, resolveTradeAccountId } from "@/lib/accounts/queries";
import {
  computeStats,
  tradeRowSchema,
  EMPTY_FILTER,
  isFilterEmpty,
  type TradeCreate,
  type TradeFilter,
  type TradeUpdate,
  type TradeListResponse,
  type TradeRow,
  type TradeStats,
} from "@/lib/trades/schema";
import { computeRMultiple } from "@/lib/risk";

/**
 * Error class that carries an HTTP-ish status. Route handlers catch
 * `TradesError` and translate it to a NextResponse; anything else
 * becomes a 500.
 */
export class TradesError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TradesError";
    this.status = status;
  }
}

/** Upper bound on the list endpoint. Past this we'd need real pagination. */
const MAX_LIST_LIMIT = 200;

/** Fetch the current user + selected trading account (auth once per call). */
async function context(): Promise<{
  user: SessionUser;
  /** Selected account id, or null = all accounts. */
  accountId: string | null;
}> {
  const user = await getUserOrThrow();
  const accountId = await getSelectedAccountId(user.id);
  return { user, accountId };
}

/**
 * Map a Prisma Trade (camelCase + Date objects) to the snake_case
 * TradeRow shape the rest of the app expects (ISO strings for dates).
 */
export function toTradeRow(t: PrismaTrade): TradeRow {
  return tradeRowSchema.parse({
    id: t.id,
    user_id: t.userId,
    pair: t.pair,
    direction: t.direction,
    entry_price: t.entryPrice,
    exit_price: t.exitPrice,
    stop_loss: t.stopLoss,
    take_profit: t.takeProfit,
    lot_size: t.lotSize,
    opened_at: t.openedAt.toISOString(),
    closed_at: t.closedAt ? t.closedAt.toISOString() : null,
    pnl: t.pnl,
    strategy: t.strategy,
    session: t.session,
    emotion: t.emotion,
    followed_plan: t.followedPlan,
    notes: t.notes,
    tags: t.tags,
    created_at: t.createdAt.toISOString(),
    account_balance: t.accountBalance,
    risk_pct: t.riskPct,
    risk_amount: t.riskAmount,
    r_multiple: t.rMultiple,
    timeframe: t.timeframe,
    mistake_type: t.mistakeType,
    screenshot_url: t.screenshotUrl,
    screenshot_after_url: t.screenshotAfterUrl,
  });
}

/** Build the Prisma data object for a new trade from TradeCreate input. */
function createInputToData(input: TradeCreate, userId: string) {
  return {
    userId,
    pair: input.pair,
    direction: input.direction,
    entryPrice: input.entry_price,
    exitPrice: input.exit_price ?? null,
    stopLoss: input.stop_loss,
    takeProfit: input.take_profit ?? null,
    lotSize: input.lot_size,
    openedAt: new Date(input.opened_at),
    closedAt: input.closed_at ? new Date(input.closed_at) : null,
    pnl: input.pnl ?? null,
    strategy: input.strategy ?? null,
    session: input.session ?? null,
    emotion: input.emotion ?? null,
    followedPlan: input.followed_plan,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
    accountBalance: input.account_balance ?? null,
    riskPct: input.risk_pct ?? null,
    riskAmount: input.risk_amount ?? null,
    timeframe: input.timeframe ?? null,
    mistakeType: input.mistake_type ?? null,
    screenshotUrl: input.screenshot_url ?? null,
    screenshotAfterUrl: input.screenshot_after_url ?? null,
    rMultiple: computeRMultiple(input.pnl ?? null, input.risk_amount ?? null),
  };
}

/**
 * Insert a new trade. user_id is taken from the authenticated session
 * (NEVER from the request body) so a malicious client can't write
 * trades into someone else's journal. The trade is stamped with the
 * selected trading account (or the user's default account when "all
 * accounts" is active).
 */
export async function createTrade(input: TradeCreate): Promise<TradeRow> {
  const { user } = await context();
  try {
    const accountId = await resolveTradeAccountId(user.id);
    const created = await db.trade.create({
      data: { ...createInputToData(input, user.id), accountId },
    });
    return toTradeRow(created);
  } catch (err) {
    throw new TradesError(500, `Failed to create trade: ${errMessage(err)}`);
  }
}

/**
 * Bulk insert multiple trades in a single Prisma call.
 *
 *  - All trades get the same userId (from the session, never the body).
 *  - Returns the inserted rows.
 *  - Prisma wraps a multi-row create in a transaction; on any row
 *    failure the whole batch rolls back.
 *
 * Used by POST /api/trades/import for CSV import.
 */
export async function bulkCreateTrades(inputs: TradeCreate[]): Promise<TradeRow[]> {
  const { user } = await context();
  if (inputs.length === 0) return [];
  try {
    const accountId = await resolveTradeAccountId(user.id);
    const created = await db.trade.createManyAndReturn({
      data: inputs.map((input) => ({
        ...createInputToData(input, user.id),
        accountId,
      })),
    });
    return created.map(toTradeRow);
  } catch (err) {
    throw new TradesError(500, `Bulk insert failed: ${errMessage(err)}`);
  }
}

/**
 * List the user's trades, most-recent-created first.
 *
 *  - `limit` capped at MAX_LIST_LIMIT (200).
 *  - `filter`: structured filter on pair / direction / tag / session /
 *    strategy / outcome / followed_plan / opened_at range.
 *  - Stats computed server-side so the client can render the header in
 *    a single round-trip.
 *
 * The filter is applied at the database layer (Prisma where) so a
 * 200-trade user filtering by tag "fomc" only receives matching rows.
 */
export async function listTrades(
  limit = 100,
  filter: TradeFilter = EMPTY_FILTER,
): Promise<TradeListResponse> {
  const { user, accountId } = await context();
  const capped = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limit)));

  const where = buildWhere(user.id, filter);
  // Multi-account: with an account selected, list only that account's
  // trades (and compute stats for them); null = all accounts.
  if (accountId) where.accountId = accountId;

  let trades: PrismaTrade[];
  try {
    trades = await db.trade.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: capped,
    });
  } catch (err) {
    throw new TradesError(500, `Failed to list trades: ${errMessage(err)}`);
  }

  const rows = trades.map(toTradeRow);
  const stats: TradeStats = computeStats(rows);
  return { trades: rows, stats, hasMore: rows.length === capped };
}

/**
 * Return the distinct set of tags the user has ever used, sorted
 * alphabetically. Fetches only the `tags` column for all the user's
 * trades and unions the arrays in JS.
 */
export async function listAllTags(): Promise<string[]> {
  const { user } = await context();
  let rows: { tags: string[] }[];
  try {
    rows = await db.trade.findMany({
      where: { userId: user.id },
      select: { tags: true },
      take: MAX_LIST_LIMIT,
    });
  } catch (err) {
    throw new TradesError(500, `Failed to list tags: ${errMessage(err)}`);
  }
  const set = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row.tags)) {
      for (const tag of row.tags) {
        if (typeof tag === "string" && tag !== "") set.add(tag);
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Fetch a single trade by id. The userId filter guarantees isolation
 * (no RLS anymore): a request for another user's trade returns null
 * → 404, without leaking existence.
 */
export async function getTrade(id: string): Promise<TradeRow> {
  const { user } = await context();
  let trade: PrismaTrade | null;
  try {
    trade = await db.trade.findFirst({ where: { id, userId: user.id } });
  } catch (err) {
    throw new TradesError(500, `Failed to fetch trade: ${errMessage(err)}`);
  }
  if (!trade) throw new TradesError(404, "Trade not found.");
  return toTradeRow(trade);
}

/**
 * Partial update. `undefined` fields are dropped before sending so we
 * don't overwrite columns the client didn't send. Null is sent as null
 * (clears the field).
 */
export async function updateTrade(id: string, input: TradeUpdate): Promise<TradeRow> {
  const { user } = await context();
  const data = updateInputToData(input);
  if (Object.keys(data).length === 0) {
    throw new TradesError(400, "No fields to update.");
  }
  // Recompute r_multiple if pnl or risk_amount changed.
  if ("pnl" in data || "riskAmount" in data) {
    let trade: PrismaTrade | null = null;
    try {
      trade = await db.trade.findFirst({ where: { id, userId: user.id } });
    } catch {
      /* fall through to the update attempt */
    }
    if (trade) {
      const pnl = "pnl" in data ? (data.pnl as number | null) : trade.pnl;
      const risk = "riskAmount" in data ? (data.riskAmount as number | null) : trade.riskAmount;
      data.rMultiple = computeRMultiple(pnl, risk);
    }
  }
  try {
    const updated = await db.trade.update({
      where: { id },
      data,
    });
    // Guard against updating another user's trade: Prisma update by id
    // doesn't filter by userId, so verify ownership after the fact.
    if (updated.userId !== user.id) {
      throw new TradesError(404, "Trade not found.");
    }
    return toTradeRow(updated);
  } catch (err) {
    if (err instanceof TradesError) throw err;
    // P2025 = record not found.
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2025") {
      throw new TradesError(404, "Trade not found.");
    }
    throw new TradesError(500, `Failed to update trade: ${errMessage(err)}`);
  }
}

/**
 * Delete a trade. Returns nothing on success. If the trade doesn't
 * exist or belongs to another user, we return 404 rather than leaking
 * existence.
 */
export async function deleteTrade(id: string): Promise<void> {
  const { user } = await context();
  let count: number;
  try {
    const res = await db.trade.deleteMany({ where: { id, userId: user.id } });
    count = res.count;
  } catch (err) {
    throw new TradesError(500, `Failed to delete trade: ${errMessage(err)}`);
  }
  if (count === 0) throw new TradesError(404, "Trade not found.");
}

// ---------------------------------------------------------------------------
// Raw fetch helper (used by report / risk-report / exposure / journal-digest
// routes and the dashboard-stats + risk server components, which all need the
// user's trades as TradeRow[] without the stats envelope listTrades returns).
// ---------------------------------------------------------------------------

export type FetchTradesOpts = {
  limit?: number;
  orderBy?: "createdAt" | "closedAt" | "openedAt";
  order?: "asc" | "desc";
  /** Inclusive bounds on opened_at. */
  openedFrom?: Date;
  openedTo?: Date;
  /** Only trades with a closed_at (realized). */
  closedOnly?: boolean;
  /** Nulls-first ordering (for closedAt asc with open trades on top). */
  nullsFirst?: boolean;
};

/**
 * Fetch the current user's trades as TradeRow[], with light ordering +
 * date-range options. Every consumer that previously did a raw
 * `supabase.from('trades').select('*').eq('user_id', ...)` should call
 * this instead so the Prisma query + snake_case mapping live in one place.
 */
export async function fetchUserTrades(opts: FetchTradesOpts = {}): Promise<TradeRow[]> {
  const { user, accountId } = await context();
  const {
    limit = 200,
    orderBy = "createdAt",
    order = "desc",
    openedFrom,
    openedTo,
    closedOnly = false,
    nullsFirst = false,
  } = opts;

  const where: Record<string, unknown> = { userId: user.id };
  // Multi-account: honor the selected account (null = all accounts).
  if (accountId) where.accountId = accountId;
  const openedAt: Record<string, unknown> = {};
  if (openedFrom) openedAt.gte = openedFrom;
  if (openedTo) openedAt.lte = openedTo;
  if (Object.keys(openedAt).length > 0) where.openedAt = openedAt;
  if (closedOnly) where.closedAt = { not: null };

  // Prisma sorts nulls last by default for asc. To put open trades
  // (null closedAt) first on an asc sort, split into two ordered queries
  // is overkill; instead use the raw orderBy nulls option via `nullsFirst`.
  const orderByClause: Record<string, unknown> = {};
  if (nullsFirst && orderBy === "closedAt") {
    orderByClause[orderBy] = { sort: order, nulls: "first" };
  } else {
    orderByClause[orderBy] = order;
  }

  try {
    const trades = await db.trade.findMany({
      where,
      orderBy: orderByClause,
      take: limit,
    });
    return trades.map(toTradeRow);
  } catch (err) {
    throw new TradesError(500, `Failed to fetch trades: ${errMessage(err)}`);
  }
}

/**
 * Fetch trades for an EXPLICIT userId (not the session).
 *
 * Server-side maintenance tasks only — the cron weekly-review loop
 * needs trades for every user without an HTTP session in scope.
 * Never call this from a user-facing route handler: pass
 * `fetchUserTrades` (session-scoped) instead.
 */
export async function fetchTradesForUserId(
  userId: string,
  opts: FetchTradesOpts = {},
): Promise<TradeRow[]> {
  const {
    limit = 200,
    orderBy = "createdAt",
    order = "desc",
    openedFrom,
    openedTo,
    closedOnly = false,
    nullsFirst = false,
  } = opts;

  const where: Record<string, unknown> = { userId };
  const openedAt: Record<string, unknown> = {};
  if (openedFrom) openedAt.gte = openedFrom;
  if (openedTo) openedAt.lte = openedTo;
  if (Object.keys(openedAt).length > 0) where.openedAt = openedAt;
  if (closedOnly) where.closedAt = { not: null };

  const orderByClause: Record<string, unknown> = {};
  if (nullsFirst && orderBy === "closedAt") {
    orderByClause[orderBy] = { sort: order, nulls: "first" };
  } else {
    orderByClause[orderBy] = order;
  }

  try {
    const trades = await db.trade.findMany({
      where,
      orderBy: orderByClause,
      take: limit,
    });
    return trades.map(toTradeRow);
  } catch (err) {
    throw new TradesError(500, `Failed to fetch trades: ${errMessage(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Filter → Prisma where
// ---------------------------------------------------------------------------

function buildWhere(userId: string, filter: TradeFilter) {
  const where: Record<string, unknown> = { userId };

  if (isFilterEmpty(filter)) return where;

  if (filter.pair) where.pair = filter.pair;
  if (filter.direction !== "all") where.direction = filter.direction;
  if (filter.tag) where.tags = { has: filter.tag };
  if (filter.session !== "all") where.session = filter.session;
  if (filter.strategy) {
    where.strategy = { equals: filter.strategy, mode: "insensitive" };
  }
  if (filter.followedPlan !== null) where.followedPlan = filter.followedPlan;

  const openedAt: Record<string, unknown> = {};
  if (filter.openedFrom) openedAt.gte = new Date(filter.openedFrom);
  if (filter.openedTo) openedAt.lte = new Date(filter.openedTo);
  if (Object.keys(openedAt).length > 0) where.openedAt = openedAt;

  switch (filter.outcome) {
    case "win":
      where.pnl = { not: null, gt: 0 };
      break;
    case "loss":
      where.pnl = { not: null, lte: 0 };
      break;
    case "open":
      where.OR = [{ closedAt: null }, { pnl: null }];
      break;
    case "breakeven":
      where.pnl = 0;
      break;
    case "all":
    default:
      break;
  }
  return where;
}

/** Map a snake_case TradeUpdate patch to Prisma camelCase data. */
function updateInputToData(input: TradeUpdate): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const map: Record<string, string> = {
    pair: "pair",
    direction: "direction",
    entry_price: "entryPrice",
    exit_price: "exitPrice",
    stop_loss: "stopLoss",
    take_profit: "takeProfit",
    lot_size: "lotSize",
    opened_at: "openedAt",
    closed_at: "closedAt",
    pnl: "pnl",
    strategy: "strategy",
    session: "session",
    emotion: "emotion",
    followed_plan: "followedPlan",
    notes: "notes",
    tags: "tags",
    account_balance: "accountBalance",
    risk_pct: "riskPct",
    risk_amount: "riskAmount",
    timeframe: "timeframe",
    mistake_type: "mistakeType",
    screenshot_url: "screenshotUrl",
    screenshot_after_url: "screenshotAfterUrl",
  };
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    const prismaKey = map[k] ?? k;
    let value: unknown = v;
    if (k === "opened_at" || k === "closed_at") {
      value = v ? new Date(v as string) : null;
    }
    data[prismaKey] = value;
  }
  return data;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
