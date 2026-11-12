/**
 * GET /api/trades/report
 *   Generate a PDF performance report for the user's trades.
 *
 * Query params:
 *  - from: ISO date (inclusive lower bound on opened_at). Default: 30 days ago.
 *  - to:   ISO date (inclusive upper bound). Default: now.
 *
 * Returns a PDF file (Content-Type: application/pdf) with a
 * Content-Disposition header suggesting a filename.
 *
 * Auth required. Rate-limited (read bucket - PDF generation is a
 * read-heavy operation but doesn't call any AI).
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tradeRowSchema, type TradeRow } from "@/lib/trades/schema";
import { buildReportData } from "@/lib/report/data";
import { renderReportPdf } from "@/lib/report/pdf";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;

    const url = new URL(req.url);
    const now = new Date();
    const toRaw = url.searchParams.get("to");
    const fromRaw = url.searchParams.get("from");
    const to = toRaw && !Number.isNaN(Date.parse(toRaw)) ? new Date(toRaw) : now;
    const from =
      fromRaw && !Number.isNaN(Date.parse(fromRaw))
        ? new Date(fromRaw)
        : new Date(now.getTime() - 30 * 24 * 60 * 60_000);

    if (from > to) {
      return NextResponse.json(
        { error: "'from' must be before 'to'." },
        { status: 400, headers: rl.headers },
      );
    }

    const user = await getUserOrThrow();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", user.id)
      .gte("opened_at", from.toISOString())
      .lte("opened_at", to.toISOString())
      .order("opened_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load trades: ${error.message}` },
        { status: 500, headers: rl.headers },
      );
    }

    const trades: TradeRow[] = (data ?? []).map((d) => tradeRowSchema.parse(d));
    const reportData = buildReportData(
      trades,
      from.toISOString(),
      to.toISOString(),
    );

    const pdfBuffer = await renderReportPdf(reportData);
    // Convert Buffer to Uint8Array for NextResponse (BodyInit expects
    // ArrayBufferView, not Node Buffer).
    const pdfBytes = new Uint8Array(pdfBuffer);

    const filename = `forexmind-report-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.pdf`;
    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBytes.byteLength),
        ...rl.headers,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/trades/report] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
