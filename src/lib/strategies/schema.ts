/**
 * Strategy library schema (zod) — doubles as the TS types.
 *
 * A Strategy is a user-defined trading system ("London breakout",
 * "News fade"). Trades reference it via Trade.strategyId; the library
 * is managed in the Strategies modal on the journal page. Free-typed
 * strategy names on new trades are auto-promoted into library rows.
 */
import { z } from "zod";

export const strategyCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(60, "Name must be 60 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or fewer.")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

export type StrategyCreate = z.infer<typeof strategyCreateSchema>;

export const strategyUpdateSchema = strategyCreateSchema.partial();
export type StrategyUpdate = z.infer<typeof strategyUpdateSchema>;

export const strategyRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  /** How many trades use this strategy (drives the management UI). */
  trade_count: z.number().int().nonnegative(),
  created_at: z.string(),
});

export type StrategyRow = z.infer<typeof strategyRowSchema>;
