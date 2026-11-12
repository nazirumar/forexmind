/**
 * Server-only data access for user profiles.
 *
 *  - getProfile(): read the user's profile row; returns defaults if
 *    no row exists yet (lazy creation).
 *  - upsertProfile(): insert-or-update the profile row.
 *
 * Both require an authenticated session. RLS scopes every query to
 * the calling user.
 *
 * The profiles table is created by the schema.sql migration (added
 * in Phase 16). If the table doesn't exist yet (user hasn't run the
 * latest migration), getProfile returns the defaults gracefully
 * instead of crashing.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserOrThrow } from "@/lib/auth";
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
 * Get the user's profile. Returns defaults if no row exists yet.
 *
 * If the profiles table doesn't exist (migration not run), we catch
 * the error and return defaults instead of crashing - the user can
 * still use the rest of the app.
 */
export async function getProfile(): Promise<ProfileRow> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Table might not exist yet - return defaults.
    console.warn("[profile] getProfile error:", error.message);
    return defaultProfile(user.id);
  }
  if (!data) {
    return defaultProfile(user.id);
  }

  return profileRowSchema.parse(data);
}

/**
 * Insert-or-update the user's profile.
 *
 * Uses Supabase's upsert with onConflict: user_id so it's a single
 * round-trip whether the row exists or not.
 */
export async function upsertProfile(input: ProfileUpdate): Promise<ProfileRow> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  // Build the patch: only include fields that were provided.
  const patch: Record<string, unknown> = { user_id: user.id };
  if (input.display_name !== undefined) patch.display_name = input.display_name;
  if (input.default_balance !== undefined) patch.default_balance = input.default_balance;
  if (input.default_risk_pct !== undefined) patch.default_risk_pct = input.default_risk_pct;
  if (input.preferred_session !== undefined) patch.preferred_session = input.preferred_session;
  if (input.default_pair !== undefined) patch.default_pair = input.default_pair;

  const { data, error } = await supabase
    .from("profiles")
    .upsert(patch, { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    throw new ProfileError(500, `Failed to save profile: ${error.message}`);
  }
  if (!data) {
    throw new ProfileError(500, "Profile upsert returned no row.");
  }

  return profileRowSchema.parse(data);
}
