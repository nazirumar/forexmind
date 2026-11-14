/**
 * /api/cron/alerts - run the price-alert sweep on demand.
 *
 * Designed for external schedulers (Vercel Cron, GitHub Actions,
 * Windows Task Scheduler, cron-job.org...). Guarded by a shared
 * secret: the caller must send `CRON_SECRET` as the `x-cron-secret`
 * header or `?secret=` query param. When CRON_SECRET is not
 * configured the endpoint refuses to run (503) so an unauthenticated
 * sweep can't be triggered by randoms.
 *
 * The sweep is a cross-user maintenance task: it evaluates every
 * active price alert against the cached FX rates and stamps
 * triggered_at. Response: { triggered, alerts: [...] }.
 *
 * GET also accepts the secret so simple pings (cron-job.org) work.
 */
import { NextResponse } from "next/server";
import { evaluateAlerts } from "@/lib/watchlist/sweep";

export const runtime = "nodejs";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // not configured -> refuse
  const url = new URL(req.url);
  return (
    req.headers.get("x-cron-secret") === secret ||
    url.searchParams.get("secret") === secret
  );
}

function unauthorized() {
  const configured = Boolean(process.env.CRON_SECRET);
  return NextResponse.json(
    {
      error: configured
        ? "Unauthorized. Send the secret via the x-cron-secret header."
        : "CRON_SECRET is not configured. Add it to .env.local to enable the cron sweep.",
    },
    { status: configured ? 401 : 503 },
  );
}

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const triggered = await evaluateAlerts();
  return NextResponse.json({ triggered: triggered.length, alerts: triggered });
}

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const triggered = await evaluateAlerts();
  return NextResponse.json({ triggered: triggered.length, alerts: triggered });
}
