/**
 * GET /api/news
 *
 * Returns the latest forex headlines, normalized to the NewsItem
 * shape. Cached for 5 minutes server-side (in-memory).
 *
 * - Query: ?limit=N (1..50, default 30) - cap on items returned.
 * - Query: ?force=1 - bypass the cache (Refresh button).
 *
 * Public endpoint: news is not user-specific data. (Authentication
 * is still enforced in production via the middleware, but we don't
 * gate it on a real session - the same headlines apply to everyone
 * and the brief later goes through /api/news/brief which DOES
 * require auth + respects the user's watchlist.)
 *
 * Response shape: NewsResponse (see src/lib/news/schema.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchNews } from "@/lib/news/fetch";

export const runtime = "nodejs";
// Cache at the Next.js fetch layer too (5 min), so concurrent
// requests don't all hit Finnhub when the in-memory cache expires.
export const revalidate = 300;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  force: z
    .enum(["1", "true", ""])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    force: url.searchParams.get("force") ?? undefined,
  });
  if (!qs.success) {
    return NextResponse.json(
      { error: `Invalid query: ${qs.error.issues[0]?.message ?? "invalid"}` },
      { status: 400 },
    );
  }

  try {
    const result = await fetchNews(qs.data.limit, qs.data.force);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/news] fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch news. Please try again shortly." },
      { status: 502 },
    );
  }
}
