/**
 * GET /auth/callback
 *
 * Supabase redirects here after the user clicks the confirmation link
 * in a signup email (or a magic link / password recovery email). The
 * URL contains a ?code=... param which we exchange for a session;
 * the session cookies are set by the server client.
 *
 * On success: redirect to `next` (default "/").
 * On failure: redirect to /login (the user can try signing in).
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Sanitize: only allow same-origin relative paths.
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  // Missing/invalid code -> back to login.
  return NextResponse.redirect(`${origin}/login`);
}
