/**
 * /api/cron/weekly-review - scheduled AI weekly review for every user.
 *
 * This is feature #3: the weekly review that used to exist only as a
 * button (POST /api/journal/digest) now runs on a schedule. Point any
 * external scheduler (Vercel Cron, Windows Task Scheduler,
 * cron-job.org, GitHub Actions) at:
 *
 *   GET /api/cron/weekly-review?secret=<CRON_SECRET>
 *
 * Guarded by the shared CRON_SECRET (see @/lib/cron/guard). 503 when
 * the secret isn't configured, 401 on a wrong secret.
 *
 * Per user (cap: MAX_USERS_PER_RUN, sequential — Groq calls aren't free):
 *  1. Skip users with no trades opened in the window.
 *  2. Skip users who already have a weekly_digest created since
 *     `from` (one review per week — dedupe).
 *  3. generateWeeklyDigest() -> saves to ai_analyses; the journal
 *     panel reads it back via GET /api/journal/digest.
 *
 * There is no email delivery yet (no provider configured); the review
 * waits in-app. When a provider lands, this is the hook point.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cronAuthorized, cronUnauthorizedResponse } from "@/lib/cron/guard";
import { generateWeeklyDigest } from "@/lib/journal/generate-digest";
import { fetchTradesForUserId } from "@/lib/trades/queries";

export const runtime = "nodejs";
export const maxDuration = 300;

/** One week, ending now. */
const WINDOW_DAYS = 7;
/** Safety cap so one run can't fan out unbounded (sequential Groq calls). */
const MAX_USERS_PER_RUN = 25;

type UserResult = {
  userId: string;
  status: "reviewed" | "skipped_recent" | "skipped_no_trades" | "error";
  analysisId?: string;
  hasEnoughData?: boolean;
};

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return cronUnauthorizedResponse();
  return runSweep();
}

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return cronUnauthorizedResponse();
  return runSweep();
}

async function runSweep() {
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60_000);

  // Candidate users: anyone with a trade opened in the window. Users
  // who didn't trade this week have nothing to review.
  let candidateIds: string[];
  try {
    const rows = await db.trade.findMany({
      where: { openedAt: { gte: from, lte: to } },
      select: { userId: true },
      distinct: ["userId"],
    });
    candidateIds = rows.map((t) => t.userId);
  } catch (err) {
    console.error("[cron-weekly-review] candidate query failed:", err);
    return NextResponse.json(
      { error: "Database unavailable." },
      { status: 503 },
    );
  }

  const results: UserResult[] = [];
  let reviewed = 0;

  for (const userId of candidateIds.slice(0, MAX_USERS_PER_RUN)) {
    try {
      // Dedupe: skip if this user already has a weekly digest created
      // inside the window (they reviewed this week already, or the
      // on-demand button beat the scheduler).
      const existing = await db.aiAnalysis.findFirst({
        where: { userId, type: "weekly_digest", createdAt: { gte: from } },
        select: { id: true },
      });
      if (existing) {
        results.push({ userId, status: "skipped_recent" });
        continue;
      }

      const { response, analysisId } = await generateWeeklyDigest(
        userId,
        from,
        to,
      );
      reviewed += 1;
      results.push({
        userId,
        status: "reviewed",
        analysisId: analysisId ?? undefined,
        hasEnoughData: response.has_enough_data,
      });
    } catch (err) {
      console.error(`[cron-weekly-review] user ${userId} failed:`, err);
      results.push({ userId, status: "error" });
    }
  }

  return NextResponse.json({
    window_start: from.toISOString(),
    window_end: to.toISOString(),
    candidates: candidateIds.length,
    reviewed,
    results,
  });
}
