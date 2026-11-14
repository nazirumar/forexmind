/**
 * GET /api/trades/meta
 *
 * Distinct label values the user has actually used: tags, strategies,
 * emotions, timeframes. Powers the dynamic suggestions in the trade
 * form (datalist) and the dynamic filter options in the journal.
 *
 * There are no hardcoded strategy/emotion lists in this app — the
 * options grow out of the user's own logged trades, which is how a
 * serious journaling platform behaves.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import { TradesError, listDistinctMeta } from "@/lib/trades/queries";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const meta = await listDistinctMeta();
    return NextResponse.json(meta, { headers: rl.headers });
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof TradesError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[/api/trades/meta] unhandled:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
