/**
 * Account domain schema (zod) — doubles as the TS types.
 *
 * An Account is a trading account (live / demo / prop firm) that owns
 * trades. NOT to be confused with the auth User (one User has many
 * Accounts). Watchlist / alerts / goals / plans stay user-level.
 */
import { z } from "zod";

export const ACCOUNT_KINDS = ["live", "demo", "prop"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const accountCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(40, "Name must be 40 characters or fewer."),
  kind: z.enum(ACCOUNT_KINDS).default("live"),
});

export type AccountCreate = z.infer<typeof accountCreateSchema>;

export const accountRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(ACCOUNT_KINDS),
  /** How many trades belong to this account (drives delete safety). */
  trade_count: z.number().int().nonnegative(),
  created_at: z.string(),
});

export type AccountRow = z.infer<typeof accountRowSchema>;

/** Name given to the lazily-created default account for existing users. */
export const DEFAULT_ACCOUNT_NAME = "Main account";
