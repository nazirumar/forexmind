/**
 * POST /api/accounts/select - switch the active trading account.
 *
 * Body: { id: string | null }. null (or a missing id) clears the
 * selection = "All accounts" view. The id must be one of the user's
 * accounts — it's verified here before the cookie is set, and trade
 * queries re-verify ownership on every read (defense in depth).
 *
 * The cookie is httpOnly and read server-side on every trade query,
 * so switching also re-renders all server components via the client's
 * router.refresh() after this returns.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import { ACCOUNT_COOKIE, AccountError } from "@/lib/accounts/queries";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const user = await getUserOrThrow();
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;

    const body = (await req.json().catch(() => ({}))) as { id?: string | null };
    const id = typeof body.id === "string" && body.id ? body.id : null;

    if (id) {
      // Ownership check before setting the cookie.
      const owned = await db.account.findFirst({
        where: { id, userId: user.id },
        select: { id: true },
      });
      if (!owned) throw new AccountError(404, "Account not found.");
    }

    const res = NextResponse.json(
      { ok: true, account_id: id },
      { headers: rl.headers },
    );
    if (id) {
      res.cookies.set(ACCOUNT_COOKIE, id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    } else {
      res.cookies.set(ACCOUNT_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
    return res;
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof AccountError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[/api/accounts/select] unhandled:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
