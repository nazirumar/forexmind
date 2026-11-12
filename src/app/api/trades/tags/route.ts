/**
 * GET /api/trades/tags
 *   Return the distinct set of tags the user has ever used across
 *   their trades, sorted alphabetically. Used to populate the tag
 *   filter dropdown in the journal UI.
 *
 * Auth required (401 if no session). Rate-limited under the read
 * bucket (same as /api/trades GET) since it's a cheap read.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import { TradesError, listAllTags } from "@/lib/trades/queries";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await getUserOrThrow();

    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    const tags = await listAllTags();
    return NextResponse.json({ tags }, { headers: rateHeaders });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof TradesError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/trades/tags] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
