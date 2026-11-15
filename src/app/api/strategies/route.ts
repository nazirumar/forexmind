/**
 * /api/strategies - the user's strategy library.
 *
 *   GET    - list strategies (auto-backfills legacy trade.strategy text
 *            into library rows on first call). Includes trade counts.
 *   POST   - create { name, description? }. Any trades already logged
 *            with that name are linked to the new row.
 *   PATCH  - update ?id= { name?, description? }. Linked trades keep
 *            the FK; their denormalized text is re-synced on rename.
 *   DELETE - delete ?id=. Trades unlink (SetNull) but keep their text,
 *            so analytics history survives.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import {
  StrategyError,
  createStrategy,
  deleteStrategy,
  listStrategies,
  updateStrategy,
} from "@/lib/strategies/queries";

export const runtime = "nodejs";

function handleErr(err: unknown) {
  if (err instanceof UnauthorizedError)
    return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof StrategyError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[/api/strategies] unhandled:", err);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const user = await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const strategies = await listStrategies(user.id);
    return NextResponse.json({ strategies }, { headers: rl.headers });
  } catch (err) {
    return handleErr(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getUserOrThrow();
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const body = await req.json().catch(() => null);
    const strategy = await createStrategy(user.id, body);
    return NextResponse.json(strategy, { status: 201, headers: rl.headers });
  } catch (err) {
    return handleErr(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getUserOrThrow();
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Missing ?id=." },
        { status: 400, headers: rl.headers },
      );
    }
    const body = await req.json().catch(() => null);
    const strategy = await updateStrategy(user.id, id, body);
    return NextResponse.json(strategy, { headers: rl.headers });
  } catch (err) {
    return handleErr(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getUserOrThrow();
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Missing ?id=." },
        { status: 400, headers: rl.headers },
      );
    }
    await deleteStrategy(user.id, id);
    return NextResponse.json({ ok: true }, { headers: rl.headers });
  } catch (err) {
    return handleErr(err);
  }
}
