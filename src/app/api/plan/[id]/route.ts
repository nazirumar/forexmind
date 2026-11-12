/**
 * /api/plan/[id]
 *
 *  GET    -> single plan (full row including rule_results + ai_observations)
 *  PATCH  -> update status (and optionally link a trade_id)
 *  DELETE -> soft-delete not implemented; users can mark status="skipped".
 *
 * Auth required (401 on no session). RLS guarantees we only ever
 * return / mutate the calling user's rows.
 */
import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  getUserOrThrow,
  enforceRateLimit,
} from "@/lib/auth";
import { planPatchSchema } from "@/lib/plan/schema";
import { getPlan, updatePlanStatus, type PlanRow } from "@/lib/plan/queries";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET /api/plan/[id]
// ---------------------------------------------------------------------------

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getUserOrThrow();

    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "Missing plan id." },
        { status: 400, headers: rl.headers },
      );
    }

    const row = await getPlan(id);
    if (!row) {
      return NextResponse.json(
        { error: "Plan not found." },
        { status: 404, headers: rl.headers },
      );
    }
    return NextResponse.json({ plan: row }, { headers: rl.headers });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/plan/[id]] GET unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/plan/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getUserOrThrow();

    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "Missing plan id." },
        { status: 400, headers: rl.headers },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400, headers: rl.headers },
      );
    }

    const parsed = planPatchSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { error: `Invalid request. ${msg}` },
        { status: 400, headers: rl.headers },
      );
    }

    const updated: PlanRow | null = await updatePlanStatus(id, {
      status: parsed.data.status,
      trade_id: parsed.data.trade_id ?? undefined,
    });
    if (!updated) {
      return NextResponse.json(
        { error: "Plan not found or update failed." },
        { status: 404, headers: rl.headers },
      );
    }
    return NextResponse.json({ plan: updated }, { headers: rl.headers });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/plan/[id]] PATCH unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
