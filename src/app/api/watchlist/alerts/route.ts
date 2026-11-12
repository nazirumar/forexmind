/**
 * /api/watchlist/alerts
 *   GET    - list the user's price alerts
 *   POST   - create a price alert
 *   DELETE - delete an alert (by id)
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import {
  WatchlistError,
  addAlert,
  deleteAlert,
  listAlerts,
} from "@/lib/watchlist/queries";
import { alertAddSchema } from "@/lib/watchlist/schema";

export const runtime = "nodejs";

function handleErr(err: unknown) {
  if (err instanceof UnauthorizedError)
    return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof WatchlistError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[/api/watchlist/alerts] unhandled:", err);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const alerts = await listAlerts();
    return NextResponse.json({ alerts }, { headers: rl.headers });
  } catch (err) {
    return handleErr(err);
  }
}

export async function POST(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const body = await req.json().catch(() => null);
    const parsed = alertAddSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid alert." },
        { status: 400, headers: rl.headers },
      );
    }
    const alert = await addAlert(parsed.data);
    return NextResponse.json(alert, { status: 201, headers: rl.headers });
  } catch (err) {
    return handleErr(err);
  }
}

export async function DELETE(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Missing id." },
        { status: 400, headers: rl.headers },
      );
    }
    await deleteAlert(id);
    return NextResponse.json({ ok: true }, { headers: rl.headers });
  } catch (err) {
    return handleErr(err);
  }
}
