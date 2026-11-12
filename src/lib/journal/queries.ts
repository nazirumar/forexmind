/**
 * Server-only data access for the AI Journal Review (Neon Postgres via Prisma).
 *
 *  - fetchTradesForReview(): get the user's N most recent CLOSED
 *    trades (we only review realized outcomes, not open trades).
 *  - saveReview(): write the AI's verdict + the analyzed_count to the
 *    ai_analyses table with type="journal_review".
 *  - listRecentReviews(): return the user's past reviews for the
 *    "history" panel.
 *
 * All three require an authenticated session. There is no RLS anymore
 * (that was a Supabase feature), so EVERY query explicitly filters by
 * userId. This is the new isolation boundary - never drop it.
 *
 * The rest of the app consumes the snake_case TradeRow shape; Prisma
 * generates camelCase fields + Date objects. `toTradeRow` (imported
 * from the trades layer, where it is the single source of truth) maps
 * between them so callers don't change.
 */
import { db } from "@/lib/db";
import { getUserOrThrow } from "@/lib/auth";
import { toTradeRow } from "@/lib/trades/queries";
import type { TradeRow } from "@/lib/trades/schema";
import type { ReviewVerdict } from "@/lib/journal/schema";
import { parseRecentReview, type RecentReview } from "@/lib/journal/schema";

/**
 * Fetch the user's N most recent CLOSED trades for AI review.
 *
 * - "Closed" = closedAt is not null. Open trades don't have a realized
 *   outcome yet, so they're not useful for pattern analysis.
 * - Ordered by closedAt descending (most recent first).
 * - Returns at most `limit` trades (default 20, capped at 50).
 *
 * Returns an empty array on failure (the route can still proceed and
 * tell the AI "no closed trades" - the model is told to set verdict
 * to "review" in that case).
 */
export async function fetchTradesForReview(limit = 20): Promise<TradeRow[]> {
  const user = await getUserOrThrow();
  try {
    const trades = await db.trade.findMany({
      where: { userId: user.id, closedAt: { not: null } },
      orderBy: { closedAt: "desc" },
      take: Math.max(1, Math.min(50, limit)),
    });
    return trades.map(toTradeRow);
  } catch (err) {
    console.warn(
      "[journal] fetchTradesForReview failed for user",
      user.id,
      ":",
      errMessage(err),
    );
    return [];
  }
}

/**
 * Save a journal-review verdict to the ai_analyses table.
 *
 *  - type           = "journal_review"
 *  - inputSummary   = JSON with the analyzed_count + the time window
 *  - output         = JSON.stringify(verdict)
 *
 * Returns the row id, or null if the save failed (non-fatal; the user
 * still gets their review in the response either way).
 */
export async function saveReview(args: {
  analyzedCount: number;
  verdict: ReviewVerdict;
  /** ISO string of the oldest trade analyzed, for the time window. */
  oldestClosedAt: string | null;
  /** ISO string of the newest trade analyzed. */
  newestClosedAt: string | null;
}): Promise<string | null> {
  const user = await getUserOrThrow();
  const inputSummary = JSON.stringify({
    analyzed_count: args.analyzedCount,
    oldest_closed_at: args.oldestClosedAt,
    newest_closed_at: args.newestClosedAt,
  });
  try {
    const created = await db.aiAnalysis.create({
      data: {
        userId: user.id,
        type: "journal_review",
        inputSummary,
        output: JSON.stringify(args.verdict),
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    console.warn(
      "[journal] saveReview failed for user",
      user.id,
      ":",
      errMessage(err),
    );
    return null;
  }
}

/**
 * List the user's recent journal reviews (most-recent first).
 *
 * Used by the "Recent reviews" panel in the journal page so the user
 * can revisit past analyses. Each row is parsed into a RecentReview
 * shape (verdict + summary extracted from the JSON output column).
 *
 * Returns at most `limit` rows (default 5). Malformed rows are filtered
 * out by parseRecentReview returning null. Prisma returns createdAt as
 * a Date; we convert it to an ISO string before handing the row to
 * parseRecentReview (which expects the snake_case / ISO-string shape).
 */
export async function listRecentReviews(limit = 5): Promise<RecentReview[]> {
  const user = await getUserOrThrow();
  try {
    const rows = await db.aiAnalysis.findMany({
      where: { userId: user.id, type: "journal_review" },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(20, limit)),
      select: { id: true, createdAt: true, inputSummary: true, output: true },
    });
    return rows
      .map((r) =>
        parseRecentReview({
          id: r.id,
          created_at: r.createdAt.toISOString(),
          input_summary: r.inputSummary,
          output: r.output,
        }),
      )
      .filter((r): r is RecentReview => r !== null);
  } catch (err) {
    console.warn(
      "[journal] listRecentReviews failed for user",
      user.id,
      ":",
      errMessage(err),
    );
    return [];
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
