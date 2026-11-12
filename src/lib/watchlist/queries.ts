/**
 * Server-only data access for watchlist + price alerts (Neon Postgres
 * via Prisma).
 *
 * No RLS anymore (that was Supabase). The user is a SessionUser
 * ({ id, email, displayName? }) from the signed session cookie, and
 * EVERY query explicitly filters by userId. This is the new isolation
 * boundary - never drop the userId filter.
 *
 * The rest of the app consumes the snake_case WatchlistRow / AlertRow
 * shapes (from schema.ts); Prisma generates camelCase fields. The
 * `to*Row` mappers bridge the two so callers don't change.
 */
import { db } from "@/lib/db";
import { getUserOrThrow } from "@/lib/auth";
import type {
  PriceAlert as PrismaPriceAlert,
  Watchlist as PrismaWatchlist,
} from "@prisma/client";
import {
  alertRowSchema,
  watchlistRowSchema,
  type AlertAdd,
  type AlertRow,
  type WatchlistAdd,
  type WatchlistRow,
} from "@/lib/watchlist/schema";

export class WatchlistError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "WatchlistError";
    this.status = status;
  }
}

/** Fetch the current user (auth happens exactly once per call). */
async function context() {
  const user = await getUserOrThrow();
  return { user };
}

// ---------------------------------------------------------------------------
// Row mappers: Prisma camelCase + Date -> snake_case ISO-string rows.
// ---------------------------------------------------------------------------

function toWatchlistRow(w: PrismaWatchlist): WatchlistRow {
  return watchlistRowSchema.parse({
    id: w.id,
    user_id: w.userId,
    pair: w.pair,
    created_at: w.createdAt.toISOString(),
  });
}

function toAlertRow(a: PrismaPriceAlert): AlertRow {
  return alertRowSchema.parse({
    id: a.id,
    user_id: a.userId,
    pair: a.pair,
    direction: a.direction,
    threshold: a.threshold,
    active: a.active,
    triggered_at: a.triggeredAt ? a.triggeredAt.toISOString() : null,
    created_at: a.createdAt.toISOString(),
  });
}

// --- Watchlist ---

/**
 * List the user's watchlist, oldest-first. The original Supabase query
 * ordered by created_at ascending; that order is preserved so the UI
 * (which renders the array in order) does not change.
 */
export async function listWatchlist(): Promise<WatchlistRow[]> {
  const { user } = await context();
  let rows: PrismaWatchlist[];
  try {
    rows = await db.watchlist.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
  } catch (err) {
    throw new WatchlistError(500, `Failed to list watchlist: ${errMessage(err)}`);
  }
  return rows.map(toWatchlistRow);
}

/**
 * Add a pair to the user's watchlist. Idempotent: if the pair is
 * already watched, the existing row is returned unchanged (no-op
 * update). userId is taken from the session, never the body.
 */
export async function addWatchlistItem(input: WatchlistAdd): Promise<WatchlistRow> {
  const { user } = await context();
  try {
    const row = await db.watchlist.upsert({
      where: { userId_pair: { userId: user.id, pair: input.pair } },
      create: { userId: user.id, pair: input.pair },
      update: {},
    });
    return toWatchlistRow(row);
  } catch (err) {
    throw new WatchlistError(500, `Failed to add watchlist item: ${errMessage(err)}`);
  }
}

/**
 * Remove a pair from the watchlist. The userId filter guarantees a
 * caller can never delete another user's item. If nothing was deleted
 * (missing or owned by someone else) we throw 404 rather than leaking
 * existence.
 */
export async function removeWatchlistItem(id: string): Promise<void> {
  const { user } = await context();
  let count: number;
  try {
    const res = await db.watchlist.deleteMany({ where: { id, userId: user.id } });
    count = res.count;
  } catch (err) {
    throw new WatchlistError(500, `Failed to remove watchlist item: ${errMessage(err)}`);
  }
  if (count === 0) throw new WatchlistError(404, "Watchlist item not found.");
}

// --- Alerts ---

/** List the user's price alerts, newest-first. */
export async function listAlerts(): Promise<AlertRow[]> {
  const { user } = await context();
  let rows: PrismaPriceAlert[];
  try {
    rows = await db.priceAlert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    throw new WatchlistError(500, `Failed to list alerts: ${errMessage(err)}`);
  }
  return rows.map(toAlertRow);
}

/**
 * Create a new price alert. New alerts start active. userId is taken
 * from the session, never the body.
 */
export async function addAlert(input: AlertAdd): Promise<AlertRow> {
  const { user } = await context();
  try {
    const row = await db.priceAlert.create({
      data: {
        userId: user.id,
        pair: input.pair,
        direction: input.direction,
        threshold: input.threshold,
        active: true,
      },
    });
    return toAlertRow(row);
  } catch (err) {
    throw new WatchlistError(500, `Failed to add alert: ${errMessage(err)}`);
  }
}

/**
 * Delete a price alert. The userId filter guarantees a caller can
 * never delete another user's alert. Returns void on success (matching
 * the original behaviour - no 404 is thrown if the row is already
 * gone).
 */
export async function deleteAlert(id: string): Promise<void> {
  const { user } = await context();
  try {
    await db.priceAlert.deleteMany({ where: { id, userId: user.id } });
  } catch (err) {
    throw new WatchlistError(500, `Failed to delete alert: ${errMessage(err)}`);
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
