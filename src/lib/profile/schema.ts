/**
 * User profile + trading preferences.
 *
 * Stored in a Supabase `profiles` table (one row per user, keyed by
 * user_id). Created lazily on first read (the GET endpoint returns
 * defaults if no row exists yet).
 *
 * Preferences:
 *  - display_name: shown in the sidebar instead of the email
 *  - default_balance: pre-fills the risk calculator's balance field
 *  - default_risk_pct: pre-fills the risk calculator's risk % field
 *  - preferred_session: the session the user trades most (asian/london/
 *    newyork/overlap) - used for defaults in the journal form
 *  - default_pair: the pair the user trades most - pre-selects in calc
 *
 * All fields except user_id are optional + nullable. The schema
 * enforces sensible bounds.
 */
import { z } from "zod";

export const SESSIONS = ["asian", "london", "newyork", "overlap"] as const;

export const PAIRS = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD",
  "NZDUSD", "EURJPY", "GBPJPY", "EURGBP", "EURCHF", "AUDJPY",
  "GBPAUD", "AUDCAD", "NZDJPY", "XAUUSD",
] as const;

/** Schema for PUT /api/profile (update). All fields optional. */
export const profileUpdateSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Display name cannot be empty.")
    .max(60, "Display name: max 60 characters.")
    .optional(),
  default_balance: z
    .number()
    .positive("Balance must be positive.")
    .max(1_000_000_000)
    .optional()
    .nullable(),
  default_risk_pct: z
    .number()
    .min(0, "Risk % cannot be negative.")
    .max(100, "Risk % cannot exceed 100.")
    .optional()
    .nullable(),
  preferred_session: z
    .enum(SESSIONS)
    .optional()
    .nullable(),
  default_pair: z
    .enum(PAIRS)
    .optional()
    .nullable(),
}).refine(
  (v) => Object.keys(v).length > 0,
  { message: "No fields to update." },
);

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Full profile row as stored in Supabase. */
export const profileRowSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  default_balance: z.number().nullable(),
  default_risk_pct: z.number().nullable(),
  preferred_session: z.enum(SESSIONS).nullable(),
  default_pair: z.enum(PAIRS).nullable(),
  updated_at: z.string(),
});

export type ProfileRow = z.infer<typeof profileRowSchema>;

/** Default profile used when no row exists yet. All fields null. */
export function defaultProfile(userId: string): ProfileRow {
  return {
    user_id: userId,
    display_name: null,
    default_balance: null,
    default_risk_pct: null,
    preferred_session: null,
    default_pair: null,
    updated_at: new Date(0).toISOString(),
  };
}
