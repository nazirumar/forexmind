/**
 * GET    /api/trades/[id]  - fetch one trade
 * PATCH  /api/trades/[id]  - partial update
 * DELETE /api/trades/[id]  - delete
 *
 * All three require an authenticated session. RLS guarantees users
 * can only ever see their own rows; a request for someone else's id
 * returns 404 (existence is not leaked).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthorizedError } from "@/lib/auth";
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
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const params = await ctx.params;
    const idCheck = idSchema.safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json(
        { error: idCheck.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 },
      );
    }
    const trade = await getTrade(idCheck.data);
    return NextResponse.json(trade);
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
    const params = await ctx.params;
    const idCheck = idSchema.safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json(
        { error: idCheck.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const parsed = tradeUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { error: `Invalid update: ${msg}` },
        { status: 400 },
      );
    }

    const updated = await updateTrade(idCheck.data, parsed.data);
    return NextResponse.json(updated);
  } catch (err) {
    return handleError(err);
  }
}

// ---- DELETE ------------------------------------------------------------

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const params = await ctx.params;
    const idCheck = idSchema.safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json(
        { error: idCheck.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 },
      );
    }
    await deleteTrade(idCheck.data);
    return new NextResponse(null, { status: 204 });
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
