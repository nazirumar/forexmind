/**
 * Shared Supabase configuration + "is it configured?" helper.
 *
 * NEXT_PUBLIC_* vars are safe to reference anywhere (they ship to the
 * browser by design). The anon key is a PUBLIC key - it only grants
 * access to rows RLS allows. The service_role key is never referenced
 * here; it stays server-only.
 *
 * `isSupabaseConfigured()` treats the sandbox placeholder values as
 * "not configured" so the app degrades gracefully in previews instead
 * of crashing on every page. In production with real values, the
 * auth guard in middleware is fully enforced.
 */
export const SUPABASE_URL: string =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_ANON_KEY: string =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function isPlaceholder(value: string): boolean {
  return value.includes("placeholder");
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) &&
    !isPlaceholder(SUPABASE_URL) &&
    !isPlaceholder(SUPABASE_ANON_KEY);
}
