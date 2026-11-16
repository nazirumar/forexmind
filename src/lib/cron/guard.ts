/**
 * Shared guard for /api/cron/* endpoints.
 *
 * Cron routes are cross-user maintenance tasks (they intentionally
 * bypass the per-user session boundary), so they authenticate with a
 * shared secret instead. Accepted forms:
 *  - `Authorization: Bearer <CRON_SECRET>` (what Vercel cron sends
 *    when the CRON_SECRET env var is defined)
 *  - `x-cron-secret: <CRON_SECRET>` header
 *  - `?secret=<CRON_SECRET>` query param (external schedulers)
 *
 * When CRON_SECRET is not configured the endpoint refuses to run
 * (503) so an unauthenticated sweep can't be triggered by randoms.
 */
import { NextResponse } from "next/server";

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // not configured -> refuse
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return (
    req.headers.get("x-cron-secret") === secret ||
    url.searchParams.get("secret") === secret
  );
}

export function cronUnauthorizedResponse(): NextResponse {
  const configured = Boolean(process.env.CRON_SECRET);
  return NextResponse.json(
    {
      error: configured
        ? "Unauthorized. Send the secret via the x-cron-secret header."
        : "CRON_SECRET is not configured. Add it to .env.local to enable cron endpoints.",
    },
    { status: configured ? 401 : 503 },
  );
}
