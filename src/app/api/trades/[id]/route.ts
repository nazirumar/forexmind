/**
 * GET    /api/trades/[id]  - fetch one trade
 * PATCH  /api/trades/[id]  - partial update
 * DELETE /api/trades/[id]  - delete
 *
 * All three require an authenticated session and are rate-limited per
 * user:
 *  - GET    -> read bucket (120 req/min burst, 4/sec refill)
 *  - PATCH  -> write bucket (60 req/min burst, 2/sec refill)
 *  - DELETE -> write bucket
 *
 * RLS guarantees users can only ever see their own rows; a request
 * for someone else's id returns 404 (existence is not leaked).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import {
  TradesError,
  getTrade,
  updateTrade,
  deleteTrade,
} from "@/lib/trades/queries";
import { tradeUpdateSchema } from "@/lib/trades/schema";

export const runtime = "nodejs";

const idSchema = z.string().uuid("Trade id must be a UUID.");

// ---- GET ---------------------------------------------------------------

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    // Auth FIRST so anonymous callers can't deplete the rate-limit
    // bucket or learn whether an id exists (401 vs 404 leaks info).
    await getUserOrThrow();

    // Rate limit (per-user read bucket).
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    const params = await ctx.params;
    const idCheck = idSchema.safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json(
        { error: idCheck.error.issues[0]?.message ?? "Invalid id." },
        { status: 400, headers: rateHeaders },
      );
    }
    const trade = await getTrade(idCheck.data);
    return NextResponse.json(trade, { headers: rateHeaders });
  } catch (err) {
    return handleError(err);
  }
}

// ---- PATCH -------------------------------------------------------------

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    // Auth FIRST (see GET above).
    await getUserOrThrow();

    // Rate limit (per-user write bucket).
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    const params = await ctx.params;
    const idCheck = idSchema.safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json(
        { error: idCheck.error.issues[0]?.message ?? "Invalid id." },
        { status: 400, headers: rateHeaders },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400, headers: rateHeaders },
      );
    }

    const parsed = tradeUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { error: `Invalid update: ${msg}` },
        { status: 400, headers: rateHeaders },
      );
    }

    const updated = await updateTrade(idCheck.data, parsed.data);
    return NextResponse.json(updated, { headers: rateHeaders });
  } catch (err) {
    return handleError(err);
  }
}

// ---- DELETE ------------------------------------------------------------

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    // Auth FIRST (see GET above).
    await getUserOrThrow();

    // Rate limit (per-user write bucket).
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    const params = await ctx.params;
    const idCheck = idSchema.safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json(
        { error: idCheck.error.issues[0]?.message ?? "Invalid id." },
        { status: 400, headers: rateHeaders },
      );
    }
    await deleteTrade(idCheck.data);
    return new NextResponse(null, { status: 204, headers: rateHeaders });
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
  console.error("[/api/trades/[id]] unhandled:", err);
  return NextResponse.json(
    { error: "Internal server error." },
    { status: 500 },
  );
}
