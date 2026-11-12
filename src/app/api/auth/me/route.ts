/**
 * GET /api/auth/me
 *   Return the current session user, or 401 when not signed in.
 *
 * Used by the client-side user menu to render the signed-in state
 * without a Supabase client.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user });
}
