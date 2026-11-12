/**
 * GET /api/trades/export
 *
 * Export the user's trades as a CSV file download.
 *
 * Flow:
 *  1. Authenticate (401 if no session).
 *  2. Rate-limit per user (read bucket: 120 req/min).
 *  3. Fetch up to 200 most-recent trades (same limit as the list endpoint).
 *  4. Convert to CSV with tradesToCsv() (pure function).
 *  5. Return as a text/csv response with Content-Disposition attachment
 *     header so the browser downloads it as a file.
 *
 * The filename is forexmind-trades-YYYY-MM-DD.csv.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import { TradesError, listTrades } from "@/lib/trades/queries";
import { tradesToCsv, exportFilename } from "@/lib/trades/csv";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    // 1. Auth first.
    await getUserOrThrow();

    // 2. Rate limit (per-user read bucket).
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    // 3. Fetch trades (cap at 200 - same as the list endpoint).
    const { trades } = await listTrades(200);

    // 4. Convert to CSV.
    const csv = tradesToCsv(trades);
    const filename = exportFilename();

    // 5. Return as a downloadable CSV file.
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        ...rateHeaders,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof TradesError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/trades/export] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
