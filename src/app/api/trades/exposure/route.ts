/**
 * GET /api/trades/exposure
 *   Live exposure & correlation analysis of OPEN positions.
 *
 * Returns JSON:
 *  - openCount, totalOpenLots, totalOpenRisk
 *  - byCurrency: net directional exposure per currency (long/short lots)
 *  - warnings: correlated over-exposure flags (e.g. long EURUSD + long
 *    GBPUSD = doubling up on USD-short)
 *  - mostConcentrated: the biggest single-currency net bet
 *
 * Auth required. Rate-limited (read bucket). Pure computation lives in
 * src/lib/trades/exposure.ts.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tradeRowSchema, type TradeRow } from "@/lib/trades/schema";
import { exposureSummary } from "@/lib/trades/exposure";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const user = await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;

    const supabase = await createSupabaseServerClient();

    // We only need open trades, but fetching all + filtering client-side
    // is simpler than a Supabase "closed_at is null" filter (which also
    // needs to exclude trades closed without a pnl). 200 is plenty for a
    // single-user journal.
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json(
        { error: `Failed to load trades: ${error.message}` },
        { status: 500, headers: rl.headers },
      );
    }

    const trades: TradeRow[] = (data ?? []).map((d) => tradeRowSchema.parse(d));
    const summary = exposureSummary(trades);

    return NextResponse.json(summary, { headers: rl.headers });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/trades/exposure] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
