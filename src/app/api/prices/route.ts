/**
 * GET /api/prices
 *
 * Returns live FX rates for the 16 supported pairs. Cached for 5 min
 * server-side (in-memory) so we make at most 1 upstream call per
 * 5 min regardless of how many clients ask.
 *
 * - Query: ?force=1 - bypass the cache (Refresh button)
 *
 * Public endpoint: prices are not user-specific. Rate-limited per-IP
 * (read bucket: 120 req/min burst, 4/sec refill) so a crawler can't
 * DOS the cache.
 *
 * Response shape: PriceResponse (see src/lib/prices/schema.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchLiveRates } from "@/lib/prices/fetch";
import { enforceRateLimit } from "@/lib/auth";
import { evaluateAlerts } from "@/lib/watchlist/sweep";

export const runtime = "nodejs";
export const revalidate = 300;

const querySchema = z.object({
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
    force: url.searchParams.get("force") ?? undefined,
  });
  if (!qs.success) {
    return NextResponse.json(
      { error: `Invalid query: ${qs.error.issues[0]?.message ?? "invalid"}` },
      { status: 400, headers: rateHeaders },
    );
  }

  try {
    const result = await fetchLiveRates(qs.data.force);

    // Piggyback the price-alert sweep on ticker refreshes: fresh rates
    // are in the cache, so this is one cheap DB query. Fire-and-forget
    // so the response latency doesn't change; the cron endpoint is the
    // guaranteed path for schedulers.
    void evaluateAlerts().catch(() => {});

    return NextResponse.json(result, { headers: rateHeaders });
  } catch (err) {
    console.error("[/api/prices] fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch live prices. Please try again shortly." },
      { status: 502, headers: rateHeaders },
    );
  }
}
