/**
 * Next.js middleware: Supabase session refresh + auth guard.
 *
 * What it does on every matched request:
 *  1. Creates a Supabase server client wired to the request cookies.
 *  2. Calls supabase.auth.getUser() - this both validates the JWT and
 *     refreshes the session cookies when they rotate.
 *  3. Redirects signed-out users to /login for ALL app pages, and
 *     signed-in users away from /login and /signup to /.
 *
 * Not configured fallback: if Supabase env vars are missing (or the
 * sandbox placeholder values are still set), the guard is skipped so
 * the app remains usable in preview. Set real values in .env.local
 * to enforce authentication. This is intentional dev ergonomics; in
 * production the values are always set, so the guard is always on.
 *
 * Runtime: edge (default). No secrets beyond the public anon key are
 * used here.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Publishable key (newer Supabase projects) with fallback to the
// legacy anon key name so both setups work.
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) &&
    !SUPABASE_URL.includes("placeholder") &&
    !SUPABASE_PUBLISHABLE_KEY.includes("placeholder");
}

/** Pages reachable without a session. */
const PUBLIC_PATHS = new Set(["/login", "/signup"]);

export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    // Dev/preview fallback: no real Supabase -> no auth enforcement.
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  // IMPORTANT: do not run any code between client creation and getUser().
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.has(pathname);

  // Signed-out -> /login for everything except the public auth pages.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = ""; // drop any query params from the protected page
    return NextResponse.redirect(url);
  }

  // Signed-in -> keep them out of /login and /signup.
  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Forward refreshed cookies to the app + browser.
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run on all pages except:
     *  - _next/static, _next/image (build assets)
     *  - favicon & image files
     *  - /api/* (route handlers authenticate themselves via getUserOrThrow)
     *  - /auth/callback (email-confirmation code exchange; the handler
     *    manages its own cookies and must not be redirected)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
