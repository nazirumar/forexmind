/**
 * /api/accounts
 *   GET    - list the user's trading accounts (creates the default
 *            "Main account" lazily on first call and backfills trades).
 *   POST   - create an account { name, kind }.
 *   DELETE - delete an account by ?id= (rejected while it has trades).
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, enforceRateLimit, getUserOrThrow } from "@/lib/auth";
import {
  AccountError,
  createAccount,
  deleteAccount,
  listAccounts,
} from "@/lib/accounts/queries";

export const runtime = "nodejs";

function handleErr(err: unknown) {
  if (err instanceof UnauthorizedError)
    return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof AccountError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[/api/accounts] unhandled:", err);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const user = await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const accounts = await listAccounts(user.id);
    return NextResponse.json({ accounts }, { headers: rl.headers });
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
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid body." },
        { status: 400, headers: rl.headers },
      );
    }
    const account = await createAccount(user.id, body);
    return NextResponse.json(account, { status: 201, headers: rl.headers });
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
    await deleteAccount(user.id, id);
    return NextResponse.json({ ok: true }, { headers: rl.headers });
  } catch (err) {
    return handleErr(err);
  }
}
