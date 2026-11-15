/**
 * GET /api/news/curated - the AI agent wire.
 *
 * Pipeline (see src/lib/news/curate.ts):
 *   scrape public forex RSS feeds -> AI agent curates
 *   (relevance filter, currency tags, category, neutral summary,
 *   weight) -> cached 15 min in-memory.
 *
 * Auth-gated like /api/news/brief: the AI pass consumes Groq tokens,
 * so anonymous callers don't burn the project's quota. Rate-limited
 * per user (read bucket - the heavy work is server-side cached, so
 * refreshes are cheap).
 *
 * Query: ?force=1 bypasses the cache (Refresh button).
 *
 * Response shape: CuratedNewsResponse (see src/lib/news/schema.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchCuratedNews } from "@/lib/news/curate";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";

export const runtime = "nodejs";

const querySchema = z.object({
  force: z
    .enum(["1", "true", ""])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export async function GET(req: Request) {
  try {
    // 1. Authenticate first so a missing session returns 401, not 503.
    await getUserOrThrow();

    // 2. Rate limit (per-user).
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    // 3. Parse query.
    const url = new URL(req.url);
    const qs = querySchema.safeParse({ force: url.searchParams.get("force") ?? undefined });
    if (!qs.success) {
      return NextResponse.json(
        { error: `Invalid query: ${qs.error.issues[0]?.message ?? "invalid"}` },
        { status: 400, headers: rateHeaders },
      );
    }

    // 4. Scrape + curate (cached server-side).
    const result = await fetchCuratedNews(qs.data.force);
    return NextResponse.json(
      {
        items: result.items,
        updated_at: result.fetchedAt,
        cached: result.cached,
        note: result.note,
      },
      { headers: rateHeaders },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return NextResponse.json({ error: err.message }, { status: 401 });
    console.error("[/api/news/curated] failed:", err);
    return NextResponse.json(
      { error: "Failed to build the AI news wire. Please try again shortly." },
      { status: 502 },
    );
  }
}
