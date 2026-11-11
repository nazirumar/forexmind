/**
 * GET /api/trades      - list the current user's trades + aggregate stats
 * POST /api/trades     - create a new trade
 *
 * Both require an authenticated session (401 if missing) and are
 * rate-limited per user:
 *  - GET  -> read bucket (120 req/min burst, 4/sec refill)
 *  - POST -> write bucket (60 req/min burst, 2/sec refill)
 *
 * All write input is zod-validated; user_id is taken from the
 * session, never from the request body.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import {
  TradesError,
  createTrade,
  listTrades,
} from "@/lib/trades/queries";
import { tradeCreateSchema } from "@/lib/trades/schema";

export const runtime = "nodejs";

// ---- GET ---------------------------------------------------------------

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(req: Request) {
  try {
    // Auth FIRST so anonymous callers can't deplete the rate-limit
    // bucket or learn whether a body is valid (401 vs 400 leaks info).
    await getUserOrThrow();

    // Rate limit (per-user read bucket).
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    const url = new URL(req.url);
    const qs = listQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!qs.success) {
      return NextResponse.json(
        { error: `Invalid query: ${qs.error.issues[0]?.message ?? "invalid"}` },
        { status: 400, headers: rateHeaders },
      );
    }
    const result = await listTrades(qs.data.limit);
    return NextResponse.json(result, { headers: rateHeaders });
  } catch (err) {
    return handleError(err);
  }
}

// ---- POST --------------------------------------------------------------

export async function POST(req: Request) {
  try {
    // Auth FIRST (see GET above).
    await getUserOrThrow();

    // Rate limit (per-user write bucket).
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400, headers: rateHeaders },
      );
    }

    const parsed = tradeCreateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { error: `Invalid trade: ${msg}` },
        { status: 400, headers: rateHeaders },
      );
    }

    const created = await createTrade(parsed.data);
    return NextResponse.json(created, { status: 201, headers: rateHeaders });
  } catch (err) {
    return handleError(err);
  }
}

// ---- Shared error mapper ----------------------------------------------

function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof TradesError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[/api/trades] unhandled:", err);
  return NextResponse.json(
    { error: "Internal server error." },
    { status: 500 },
  );
}
