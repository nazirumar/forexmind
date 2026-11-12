/**
 * Trading Goals - schema + types.
 *
 * A user has at most one row of goals. Every field is nullable so the
 * user can enable only the rules they care about; NULL means "this
 * rule is not enforced".
 *
 * The pure rules engine in rules.ts evaluates recent trades against
 * these goals and returns a list of violations with dates + severity.
 */
import { z } from "zod";

/** Schema for PUT /api/goals (upsert). All fields optional + nullable. */
export const goalsUpdateSchema = z
  .object({
    max_trades_per_day: z
      .number()
      .int()
      .min(1, "Max trades per day must be at least 1.")
      .max(50, "Max trades per day: 50 cap.")
      .nullable()
      .optional(),
    max_daily_loss_pct: z
      .number()
      .min(0, "Daily loss % cannot be negative.")
      .max(100, "Daily loss % cannot exceed 100.")
      .nullable()
      .optional(),
    min_rr_target: z
      .number()
      .min(0, "Min RR cannot be negative.")
      .max(100, "Min RR: 100 cap.")
      .nullable()
      .optional(),
    max_consecutive_losses: z
      .number()
      .int()
      .min(1, "Max consecutive losses must be at least 1.")
      .max(20, "Max consecutive losses: 20 cap.")
      .nullable()
      .optional(),
    require_followed_plan: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No fields to update.",
  });

export type GoalsUpdate = z.infer<typeof goalsUpdateSchema>;

/** Full goals row as stored in Supabase. */
export const goalsRowSchema = z.object({
  user_id: z.string().uuid(),
  max_trades_per_day: z.number().int().nullable(),
  max_daily_loss_pct: z.number().nullable(),
  min_rr_target: z.number().nullable(),
  max_consecutive_losses: z.number().int().nullable(),
  require_followed_plan: z.boolean(),
  updated_at: z.string(),
});

export type GoalsRow = z.infer<typeof goalsRowSchema>;

/** Default goals (nothing enforced) - returned when the user hasn't saved any. */
export const DEFAULT_GOALS: GoalsRow = {
  user_id: "",
  max_trades_per_day: null,
  max_daily_loss_pct: null,
  min_rr_target: null,
  max_consecutive_losses: null,
  require_followed_plan: false,
  updated_at: new Date(0).toISOString(),
};
