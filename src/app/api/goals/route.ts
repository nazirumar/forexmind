/**
 * GET  /api/goals  - read the user's goals row.
 * PUT  /api/goals  - upsert the user's goals row.
 *
 * Auth required (401 if no session). Rate-limited: read bucket on GET,
 * write bucket on PUT.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import { GoalsError, getGoals, upsertGoals } from "@/lib/goals/queries";
import { goalsUpdateSchema } from "@/lib/goals/schema";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const goals = await getGoals();
    return NextResponse.json(goals, { headers: rl.headers });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof GoalsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/goals GET] unhandled:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await getUserOrThrow();
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

    const parsed = goalsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { error: `Invalid goals: ${msg}` },
        { status: 400, headers: rateHeaders },
      );
    }

    const saved = await upsertGoals(parsed.data);
    return NextResponse.json(saved, { headers: rateHeaders });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof GoalsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/goals PUT] unhandled:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
