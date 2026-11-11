/**
 * Server-only data access for the trade journal.
 *
 * Every function in this module:
 *  1. Authenticates the caller with getUserOrThrow() - so we always
 *     have a real user.id to scope queries by.
 *  2. Uses the server Supabase client (cookie-bound) - so RLS is
 *     enforced end-to-end. Even if a bug here sent a query without a
 *     user_id filter, Supabase would still refuse to return rows
 *     owned by another user.
 *  3. Returns typed data (TradeRow / TradeStats / TradeListResponse)
 *     or throws a TradesError that the route handler maps to an HTTP
 *     status.
 *
 * This is the ONLY place in the codebase that touches the trades
 * table. Route handlers and Server Components import from here; they
 * never write raw Supabase queries themselves.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserOrThrow } from "@/lib/auth";
import type { User } from "@supabase/supabase-js";
import {
  computeStats,
  tradeRowSchema,
  type TradeCreate,
  type TradeUpdate,
  type TradeListResponse,
  type TradeRow,
  type TradeStats,
} from "@/lib/trades/schema";

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

/**
 * Build a Supabase client + fetch the current user. Used by every
 * function below so the auth check happens exactly once per call.
 */
async function context() {
  const user: User = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}

/**
 * Insert a new trade. user_id is taken from the authenticated session
 * (NEVER from the request body) so a malicious client can't write
 * trades into someone else's journal.
 */
export async function createTrade(input: TradeCreate): Promise<TradeRow> {
  const { user, supabase } = await context();

  const row = {
    user_id: user.id,
    pair: input.pair,
    direction: input.direction,
    entry_price: input.entry_price,
    exit_price: input.exit_price ?? null,
    stop_loss: input.stop_loss,
    take_profit: input.take_profit ?? null,
    lot_size: input.lot_size,
    opened_at: input.opened_at,
    closed_at: input.closed_at ?? null,
    pnl: input.pnl ?? null,
    strategy: input.strategy ?? null,
    session: input.session ?? null,
    emotion: input.emotion ?? null,
    followed_plan: input.followed_plan,
    notes: input.notes ?? null,
  };

  const { data, error } = await supabase
    .from("trades")
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new TradesError(500, `Failed to create trade: ${error.message}`);
  }
  if (!data) {
    throw new TradesError(500, "Trade insert returned no row.");
  }

  return tradeRowSchema.parse(data);
}

/**
 * List the user's trades, most-recent-created first.
 *
 * - `limit` capped at MAX_LIST_LIMIT (200). Past that, we'd add cursor
 *   pagination (Phase X+).
 * - Stats computed server-side so the client can render the
 *   dashboard-style header in a single round-trip.
 */
export async function listTrades(limit = 100): Promise<TradeListResponse> {
  const { supabase } = await context();
  const capped = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limit)));

  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(capped);

  if (error) {
    throw new TradesError(500, `Failed to list trades: ${error.message}`);
  }
  if (!data) {
    throw new TradesError(500, "Trade list returned no data.");
  }

  const trades = (data as unknown[]).map((d) => tradeRowSchema.parse(d));
  const stats: TradeStats = computeStats(trades);

  return {
    trades,
    stats,
    hasMore: trades.length === capped, // hint, not authoritative
  };
}

/**
 * Fetch a single trade by id. RLS guarantees we can only ever see
 * rows owned by the current user, so we don't need an explicit
 * user_id filter; if a user passes another user's id, Supabase
 * returns no row and we translate that to a 404.
 */
export async function getTrade(id: string): Promise<TradeRow> {
  const { supabase } = await context();

  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new TradesError(500, `Failed to fetch trade: ${error.message}`);
  }
  if (!data) {
    throw new TradesError(404, "Trade not found.");
  }

  return tradeRowSchema.parse(data);
}

/**
 * Partial update. `undefined` fields are dropped before sending so
 * we don't overwrite columns the client didn't send. Null is sent
 * as null (clears the field).
 */
export async function updateTrade(
  id: string,
  input: TradeUpdate,
): Promise<TradeRow> {
  const { supabase } = await context();

  // Strip undefined so the patch only touches provided fields.
  // We keep null (the user is clearing the field).
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) patch[k] = v;
  }

  if (Object.keys(patch).length === 0) {
    throw new TradesError(400, "No fields to update.");
  }

  const { data, error } = await supabase
    .from("trades")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    throw new TradesError(500, `Failed to update trade: ${error.message}`);
  }
  if (!data) {
    throw new TradesError(404, "Trade not found.");
  }

  return tradeRowSchema.parse(data);
}

/**
 * Delete a trade. Returns 204-style success. If the trade doesn't
 * exist or belongs to another user (RLS hides it), we return 404
 * rather than leaking existence.
 */
export async function deleteTrade(id: string): Promise<void> {
  const { supabase } = await context();

  const { data, error } = await supabase
    .from("trades")
    .delete({ count: "exact" })
    .eq("id", id)
    .select();

  if (error) {
    throw new TradesError(500, `Failed to delete trade: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new TradesError(404, "Trade not found.");
  }
}
