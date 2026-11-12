/**
 * /api/watchlist
 *   GET    - list the user's watched pairs
 *   POST   - add a pair to the watchlist
 *   DELETE - remove a pair (by id)
 *
 * Auth required. Rate-limited (read on GET, write on POST/DELETE).
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import {
  WatchlistError,
  addWatchlistItem,
  listWatchlist,
  removeWatchlistItem,
} from "@/lib/watchlist/queries";
import { watchlistAddSchema } from "@/lib/watchlist/schema";

export const runtime = "nodejs";

function handleErr(err: unknown) {
  if (err instanceof UnauthorizedError)
    return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof WatchlistError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[/api/watchlist] unhandled:", err);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const items = await listWatchlist();
    return NextResponse.json({ items }, { headers: rl.headers });
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
    const parsed = watchlistAddSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid pair." },
        { status: 400, headers: rl.headers },
      );
    }
    const item = await addWatchlistItem(parsed.data);
    return NextResponse.json(item, { status: 201, headers: rl.headers });
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
    await removeWatchlistItem(id);
    return NextResponse.json({ ok: true }, { headers: rl.headers });
  } catch (err) {
    return handleErr(err);
  }
}
