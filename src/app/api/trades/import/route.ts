/**
 * POST /api/trades/import
 *
 * Import trades from a CSV string. The client sends `{ csv: string }`,
 * the server parses + validates with the pure parseTradesCsv() helper,
 * bulk-inserts the valid rows, and returns `{ imported, errors }`.
 *
 * Flow:
 *  1. Authenticate (401 if no session).
 *  2. Rate-limit per user (write bucket: 60 req/min burst, 2/sec refill).
 *  3. Parse + validate body: { csv: string (max 500KB) }.
 *  4. Parse the CSV with parseTradesCsv() (pure function, no I/O).
 *  5. If there are 0 valid trades, return 400 with the errors.
 *  6. Bulk-insert the valid trades via bulkCreateTrades().
 *  7. Return { imported: number, errors: Array<{row, error}> }.
 *
 * Notes:
 *  - We cap the CSV at 500KB to prevent abuse. That's roughly 5000 trades.
 *  - We cap the number of trades per import at 500 (Supabase bulk insert
 *    limit per call). If the CSV has more, we return 400 with a message.
 *  - Invalid rows are reported back with their row numbers so the user
 *    can fix them in their spreadsheet and re-upload.
 *  - The bulk insert is atomic: either all valid trades are inserted,
 *    or none are (Supabase rolls back on error).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import { TradesError, bulkCreateTrades } from "@/lib/trades/queries";
import { parseTradesCsv } from "@/lib/trades/csv";

export const runtime = "nodejs";

const MAX_CSV_SIZE = 500 * 1024; // 500KB
const MAX_TRADES_PER_IMPORT = 500;

const importRequestSchema = z.object({
  csv: z
    .string()
    .min(1, "CSV content is required.")
    .max(MAX_CSV_SIZE, `CSV too large. Max ${MAX_CSV_SIZE} bytes (~5000 trades).`),
});

export async function POST(req: Request) {
  try {
    // 1. Auth first so anonymous callers can't deplete the rate-limit
    //    bucket or learn whether a body is valid (401 vs 400 leaks info).
    await getUserOrThrow();

    // 2. Rate limit (per-user write bucket).
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    // 3. Parse + validate body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400, headers: rateHeaders },
      );
    }

    const parsed = importRequestSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { error: `Invalid request. ${msg}` },
        { status: 400, headers: rateHeaders },
      );
    }

    // 4. Parse the CSV (pure function).
    const result = parseTradesCsv(parsed.data.csv);

    // 5. Cap at MAX_TRADES_PER_IMPORT.
    if (result.valid.length > MAX_TRADES_PER_IMPORT) {
      return NextResponse.json(
        {
          error: `Too many trades in CSV. Max ${MAX_TRADES_PER_IMPORT} per import; you have ${result.valid.length}.`,
        },
        { status: 400, headers: rateHeaders },
      );
    }

    if (result.valid.length === 0) {
      return NextResponse.json(
        {
          error: "No valid trades found in CSV.",
          errors: result.errors,
          total: result.total,
        },
        { status: 400, headers: rateHeaders },
      );
    }

    // 6. Bulk-insert the valid trades.
    const inserted = await bulkCreateTrades(result.valid);

    return NextResponse.json(
      {
        imported: inserted.length,
        errors: result.errors,
        total: result.total,
      },
      { status: 201, headers: rateHeaders },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof TradesError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/trades/import] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
