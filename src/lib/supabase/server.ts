/**
 * Server-side Supabase client for Server Components and Route Handlers.
 *
 * Uses the public anon key with the caller's auth cookie, so the
 * resulting client is scoped to the signed-in user and every query is
 * filtered by RLS. For admin-only operations (never user-driven), a
 * service-role client would be used instead - that comes later, if
 * ever needed, and would live in a separate server-only module.
 *
 * Cookie note: setAll() throws when called from a Server Component
 * render (you cannot mutate cookies there). That is expected and
 * safe to ignore because middleware refreshes auth cookies on every
 * request. Route handlers CAN set cookies, so the try/catch only
 * swallows the Server Component case.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component render - ignore; middleware refreshes sessions.
        }
      },
    },
  });
}

/**
 * Admin client using SUPABASE_SERVICE_ROLE_KEY. Server-only, bypasses
 * RLS. Reserved for future maintenance tasks; user-facing code must
 * NOT use this because it would defeat Row Level Security.
 */
export async function createSupabaseAdminClient(): Promise<SupabaseClient> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations are unavailable.",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Admin client should never set auth cookies.
      },
    },
  });
}
