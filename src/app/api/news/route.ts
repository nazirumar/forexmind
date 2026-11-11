/**
 * GET /api/news
 *
 * Returns the latest forex headlines, normalized to the NewsItem
 * shape. Cached for 5 minutes server-side (in-memory).
 *
 * - Query: ?limit=N (1..50, default 30) - cap on items returned.
 * - Query: ?force=1 - bypass the cache (Refresh button).
 *
 * Public endpoint: news is not user-specific data. We still rate-limit
 * per-IP (read bucket: 120 req/min burst, 4/sec refill) so a crawler
 * can't DOS the cache. Authenticated users get their own per-user
 * bucket via enforceRateLimit's user-id fallback.
 *
 * Response shape: NewsResponse (see src/lib/news/schema.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchNews } from "@/lib/news/fetch";
import { enforceRateLimit } from "@/lib/auth";

export const runtime = "nodejs";
export const revalidate = 300;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  force: z
    .enum(["1", "true", ""])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export async function GET(req: Request) {
  // Rate limit: per-IP for anonymous, per-user for signed-in.
  const rl = await enforceRateLimit(req, "read");
  if (!rl.ok) return rl.response;
  const rateHeaders = rl.headers;

  const url = new URL(req.url);
  const qs = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    force: url.searchParams.get("force") ?? undefined,
  });
  if (!qs.success) {
    return NextResponse.json(
      { error: `Invalid query: ${qs.error.issues[0]?.message ?? "invalid"}` },
      { status: 400, headers: rateHeaders },
    );
  }

  try {
    const result = await fetchNews(qs.data.limit, qs.data.force);
    return NextResponse.json(result, { headers: rateHeaders });
  } catch (err) {
    console.error("[/api/news] fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch news. Please try again shortly." },
      { status: 502, headers: rateHeaders },
    );
  }
}
