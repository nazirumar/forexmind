/**
 * GET /auth/callback
 *
 * Legacy stub. With Neon-backed session auth there is no email-
 * confirmation flow, so this route is no longer used for code
 * exchange. It redirects home (or to /login if not signed in - the
 * middleware handles that). Kept so old links/bookmarks don't 404.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/`);
}
