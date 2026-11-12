/**
 * Server-only data access for trading goals.
 *
 *  - getGoals(): read the user's goals row (or DEFAULT_GOALS).
 *  - upsertGoals(): insert or update the single row.
 *
 * RLS scopes every query to the calling user.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserOrThrow } from "@/lib/auth";
import { DEFAULT_GOALS, goalsRowSchema, type GoalsUpdate } from "@/lib/goals/schema";

export class GoalsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GoalsError";
    this.status = status;
  }
}

async function context() {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}

/** Read the user's goals row. Returns DEFAULT_GOALS if none exists yet. */
export async function getGoals() {
  const { user, supabase } = await context();
  const { data, error } = await supabase
    .from("trading_goals")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new GoalsError(500, `Failed to load goals: ${error.message}`);
  }
  if (!data) return { ...DEFAULT_GOALS, user_id: user.id };
  return goalsRowSchema.parse(data);
}

/** Insert or update the user's goals row. */
export async function upsertGoals(input: GoalsUpdate) {
  const { user, supabase } = await context();

  const row = {
    user_id: user.id,
    max_trades_per_day: input.max_trades_per_day ?? null,
    max_daily_loss_pct: input.max_daily_loss_pct ?? null,
    min_rr_target: input.min_rr_target ?? null,
    max_consecutive_losses: input.max_consecutive_losses ?? null,
    require_followed_plan: input.require_followed_plan ?? false,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("trading_goals")
    .upsert(row, { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    throw new GoalsError(500, `Failed to save goals: ${error.message}`);
  }
  if (!data) {
    throw new GoalsError(500, "Goals upsert returned no row.");
  }
  return goalsRowSchema.parse(data);
}
