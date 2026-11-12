/**
 * Next.js middleware: session-cookie auth guard.
 *
 * Replaces the Supabase session-refresh middleware. Middleware runs on
 * the Edge runtime, where Node's `crypto` (HMAC) is unavailable, so
 * this guard checks the *presence* of the `forexmind_session` cookie
 * purely for redirect UX. The real signature verification happens
 * server-side in getUserOrThrow() (Node runtime) on every protected
 * route + server component - a tampered cookie passes this guard but
 * is rejected with 401 by every data call. So the middleware is UX,
 * not a security boundary.
 *
 * Behaviour:
 *  - No cookie + protected path -> redirect to /login.
 *  - Cookie present + /login or /signup -> redirect to /.
 *  - Otherwise: pass through.
 */
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "forexmind_session";
const PUBLIC_PATHS = new Set(["/login", "/signup"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.has(pathname);
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // Signed-out (no cookie) -> /login for protected pages.
  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Signed-in -> keep them out of /login and /signup.
  if (hasSession && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run on all pages except build assets, images, API routes (they
     * authenticate themselves via getUserOrThrow) and /auth/callback
     * (kept for legacy redirect compatibility).
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
