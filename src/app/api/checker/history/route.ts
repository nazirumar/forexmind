/**
 * GET /api/checker/history
 *
 * Returns the user's recent trade-check analyses (most-recent first).
 * Each row is parsed into a RecentCheck shape (idea + verdict + summary
 * extracted from the ai_analyses JSON columns).
 *
 * Flow:
 *  1. Authenticate (401 if no session).
 *  2. Rate-limit per user (read bucket: 120 req/min).
 *  3. Query ai_analyses where type="trade_check", most-recent first.
 *  4. Parse each row with parseRecentCheck(); drop malformed rows.
 *  5. Return { checks: RecentCheck[] }.
 *
 * Used by the "Recent checks" panel on /checker so the user can
 * revisit past verdicts without re-running the AI.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import { listRecentChecks } from "@/lib/checker/queries";
import { parseRecentCheck, type RecentCheck } from "@/lib/checker/schema";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export async function GET(req: Request) {
  try {
    // 1. Auth first - no anonymous access to history.
    await getUserOrThrow();

    // 2. Rate limit (per-user read bucket).
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    // 3. Parse query (limit, default 10, capped at 20).
    const url = new URL(req.url);
    const qs = querySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!qs.success) {
      return NextResponse.json(
        { error: `Invalid query: ${qs.error.issues[0]?.message ?? "invalid"}` },
        { status: 400, headers: rateHeaders },
      );
    }

    // 4. Fetch + parse.
    const rows = await listRecentChecks(qs.data.limit);
    const checks: RecentCheck[] = rows
      .map(parseRecentCheck)
      .filter((c): c is RecentCheck => c !== null);

    return NextResponse.json({ checks }, { headers: rateHeaders });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/checker/history] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
