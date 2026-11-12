/**
 * Server-only data access for trading goals (Neon Postgres via Prisma).
 *
 *  - getGoals(): read the user's goals row (or DEFAULT_GOALS).
 *  - upsertGoals(): insert or update the single row.
 *
 * No RLS anymore (that was Supabase). The user is a SessionUser
 * ({ id, email, displayName? }) from the signed session cookie, and
 * EVERY query explicitly filters by userId. This is the new isolation
 * boundary - never drop the userId filter.
 *
 * The rest of the app consumes the snake_case GoalsRow shape (from
 * schema.ts); Prisma generates camelCase fields. `toGoalsRow` maps
 * between them so callers don't change.
 */
import { db } from "@/lib/db";
import { getUserOrThrow } from "@/lib/auth";
import type { TradingGoal as PrismaTradingGoal } from "@prisma/client";
import { DEFAULT_GOALS, goalsRowSchema, type GoalsRow, type GoalsUpdate } from "@/lib/goals/schema";

export class GoalsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GoalsError";
    this.status = status;
  }
}

/** Fetch the current user (auth happens exactly once per call). */
async function context() {
  const user = await getUserOrThrow();
  return { user };
}

/**
 * Map a Prisma TradingGoal (camelCase + Date) to the snake_case GoalsRow
 * shape the rest of the app expects (ISO string for updated_at).
 */
function toGoalsRow(g: PrismaTradingGoal): GoalsRow {
  return goalsRowSchema.parse({
    user_id: g.userId,
    max_trades_per_day: g.maxTradesPerDay,
    max_daily_loss_pct: g.maxDailyLossPct,
    min_rr_target: g.minRrTarget,
    max_consecutive_losses: g.maxConsecutiveLosses,
    require_followed_plan: g.requireFollowedPlan,
    updated_at: g.updatedAt.toISOString(),
  });
}

/** Read the user's goals row. Returns DEFAULT_GOALS if none exists yet. */
export async function getGoals(): Promise<GoalsRow> {
  const { user } = await context();
  let row: PrismaTradingGoal | null;
  try {
    row = await db.tradingGoal.findUnique({ where: { userId: user.id } });
  } catch (err) {
    throw new GoalsError(500, `Failed to load goals: ${errMessage(err)}`);
  }
  if (!row) return { ...DEFAULT_GOALS, user_id: user.id };
  return toGoalsRow(row);
}

/**
 * Insert or update the user's goals row.
 *
 * Mirrors the original Supabase behaviour: every field is written on
 * every save, with unset fields cleared to null (or false for
 * require_followed_plan). userId is taken from the authenticated
 * session (NEVER from the request body).
 */
export async function upsertGoals(input: GoalsUpdate): Promise<GoalsRow> {
  const { user } = await context();

  const data = {
    maxTradesPerDay: input.max_trades_per_day ?? null,
    maxDailyLossPct: input.max_daily_loss_pct ?? null,
    minRrTarget: input.min_rr_target ?? null,
    maxConsecutiveLosses: input.max_consecutive_losses ?? null,
    requireFollowedPlan: input.require_followed_plan ?? false,
  };

  try {
    const row = await db.tradingGoal.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    return toGoalsRow(row);
  } catch (err) {
    throw new GoalsError(500, `Failed to save goals: ${errMessage(err)}`);
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
