/**
 * GET /api/calendar
 *
 * Returns the economic calendar for [now-2d, now+14d].
 * Cached for 5 min server-side.
 *
 * - Query: ?force=1 - bypass the cache (Refresh button)
 * - Query: ?days=N - how many days ahead to look (default 14, max 30)
 *
 * Public endpoint: calendar is not user-specific. Rate-limited per-IP
 * (read bucket) so a crawler can't DOS the cache.
 *
 * Response shape: CalendarResponse (see src/lib/calendar/schema.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchCalendar } from "@/lib/calendar/fetch";
import { enforceRateLimit } from "@/lib/auth";

export const runtime = "nodejs";
export const revalidate = 300;

const querySchema = z.object({
  force: z
    .enum(["1", "true", ""])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export async function GET(req: Request) {
  const rl = await enforceRateLimit(req, "read");
  if (!rl.ok) return rl.response;
  const rateHeaders = rl.headers;

  const url = new URL(req.url);
  const qs = querySchema.safeParse({
    force: url.searchParams.get("force") ?? undefined,
  });
  if (!qs.success) {
    return NextResponse.json(
      { error: `Invalid query: ${qs.error.issues[0]?.message ?? "invalid"}` },
      { status: 400, headers: rateHeaders },
    );
  }

  try {
    const result = await fetchCalendar(qs.data.force);
    return NextResponse.json(result, { headers: rateHeaders });
  } catch (err) {
    console.error("[/api/calendar] fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch calendar. Please try again shortly." },
      { status: 502, headers: rateHeaders },
    );
  }
}
