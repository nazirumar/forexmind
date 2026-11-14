/**
 * /api/cron/alerts - run the price-alert sweep on demand.
 *
 * Designed for external schedulers (Vercel Cron, GitHub Actions,
 * Windows Task Scheduler, cron-job.org...). Guarded by the shared
 * CRON_SECRET (see @/lib/cron/guard): the caller sends it as the
 * `x-cron-secret` header or `?secret=` query param. 503 when not
 * configured, 401 on a wrong secret.
 *
 * The sweep is a cross-user maintenance task: it evaluates every
 * active price alert against the cached FX rates and stamps
 * triggered_at. Response: { triggered, alerts: [...] }.
 */
import { NextResponse } from "next/server";
import { evaluateAlerts } from "@/lib/watchlist/sweep";
import { cronAuthorized, cronUnauthorizedResponse } from "@/lib/cron/guard";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return cronUnauthorizedResponse();
  const triggered = await evaluateAlerts();
  return NextResponse.json({ triggered: triggered.length, alerts: triggered });
}

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return cronUnauthorizedResponse();
  const triggered = await evaluateAlerts();
  return NextResponse.json({ triggered: triggered.length, alerts: triggered });
}
