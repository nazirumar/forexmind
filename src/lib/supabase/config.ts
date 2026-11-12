/**
 * Shared Supabase configuration + "is it configured?" helper.
 *
 * NEXT_PUBLIC_* vars are safe to reference anywhere (they ship to the
 * browser by design). The publishable key is a PUBLIC key - it only
 * grants access to rows RLS allows. The service_role key is never
 * referenced here; it stays server-only.
 *
 * Env var names: Supabase's newer projects issue a "publishable key"
 * (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, value starts with
 * `sb_publishable_`). Legacy projects use an "anon key"
 * (NEXT_PUBLIC_SUPABASE_ANON_KEY). We read the publishable key first
 * and fall back to the anon key so both setups work.
 *
 * `isSupabaseConfigured()` treats the sandbox placeholder values as
 * "not configured" so the app degrades gracefully in previews instead
 * of crashing on every page. In production with real values, the
 * auth guard in middleware is fully enforced.
 */
export const SUPABASE_URL: string =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * The public publishable key (or legacy anon key). Safe to expose to
 * the browser - RLS restricts every table to the owning user.
 */
export const SUPABASE_PUBLISHABLE_KEY: string =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

function isPlaceholder(value: string): boolean {
  return value.includes("placeholder");
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) &&
    !isPlaceholder(SUPABASE_URL) &&
    !isPlaceholder(SUPABASE_PUBLISHABLE_KEY);
}
