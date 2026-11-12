/**
 * Server-only data access for user profiles (Neon Postgres via Prisma).
 *
 *  - getProfile(): read the user's profile row; returns defaults if no
 *    row exists yet (lazy creation).
 *  - upsertProfile(): insert-or-update the profile row.
 *
 * No RLS anymore (that was Supabase). The user is a SessionUser
 * ({ id, email, displayName? }) from the signed session cookie, and
 * EVERY query explicitly filters by userId. This is the new isolation
 * boundary - never drop the userId filter.
 *
 * The rest of the app consumes the snake_case ProfileRow shape (from
 * schema.ts); Prisma generates camelCase fields. `toProfileRow` maps
 * between them so callers don't change.
 */
import { db } from "@/lib/db";
import { getUserOrThrow } from "@/lib/auth";
import type { Profile as PrismaProfile } from "@prisma/client";
import {
  defaultProfile,
  profileRowSchema,
  type ProfileRow,
  type ProfileUpdate,
} from "@/lib/profile/schema";

export class ProfileError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ProfileError";
    this.status = status;
  }
}

/**
 * Map a Prisma Profile (camelCase + Date) to the snake_case ProfileRow
 * shape the rest of the app expects (ISO string for updated_at).
 */
function toProfileRow(p: PrismaProfile): ProfileRow {
  return profileRowSchema.parse({
    user_id: p.userId,
    display_name: p.displayName,
    default_balance: p.defaultBalance,
    default_risk_pct: p.defaultRiskPct,
    preferred_session: p.preferredSession,
    default_pair: p.defaultPair,
    updated_at: p.updatedAt.toISOString(),
  });
}

/**
 * Get the user's profile. Returns defaults if no row exists yet.
 *
 * If the underlying read fails for any reason we return defaults
 * instead of crashing - the user can still use the rest of the app
 * (mirrors the original "table might not exist yet" tolerance).
 */
export async function getProfile(): Promise<ProfileRow> {
  const user = await getUserOrThrow();

  let row: PrismaProfile | null;
  try {
    row = await db.profile.findUnique({ where: { userId: user.id } });
  } catch (err) {
    console.warn("[profile] getProfile error:", errMessage(err));
    return defaultProfile(user.id);
  }
  if (!row) {
    return defaultProfile(user.id);
  }

  return toProfileRow(row);
}

/**
 * Insert-or-update the user's profile.
 *
 * Only fields the caller actually sent are written, so unset fields
 * keep their existing value on update (non-destructive). On insert,
 * fields the caller didn't send default to null. userId is taken from
 * the authenticated session (NEVER from the request body).
 */
export async function upsertProfile(input: ProfileUpdate): Promise<ProfileRow> {
  const user = await getUserOrThrow();

  // Build the patch: only include fields that were provided.
  const update: {
    displayName?: string | null;
    defaultBalance?: number | null;
    defaultRiskPct?: number | null;
    preferredSession?: string | null;
    defaultPair?: string | null;
  } = {};
  if (input.display_name !== undefined) update.displayName = input.display_name;
  if (input.default_balance !== undefined) update.defaultBalance = input.default_balance;
  if (input.default_risk_pct !== undefined) update.defaultRiskPct = input.default_risk_pct;
  if (input.preferred_session !== undefined) update.preferredSession = input.preferred_session;
  if (input.default_pair !== undefined) update.defaultPair = input.default_pair;

  // On insert, fields not in the patch default to null.
  const create = {
    userId: user.id,
    displayName: input.display_name ?? null,
    defaultBalance: input.default_balance ?? null,
    defaultRiskPct: input.default_risk_pct ?? null,
    preferredSession: input.preferred_session ?? null,
    defaultPair: input.default_pair ?? null,
  };

  try {
    const row = await db.profile.upsert({
      where: { userId: user.id },
      create,
      update,
    });
    return toProfileRow(row);
  } catch (err) {
    throw new ProfileError(500, `Failed to save profile: ${errMessage(err)}`);
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
