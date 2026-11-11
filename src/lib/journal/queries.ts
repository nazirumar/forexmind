/**
 * Server-only data access for the AI Journal Review.
 *
 *  - fetchTradesForReview(): get the user's N most recent CLOSED
 *    trades (we only review realized outcomes, not open trades).
 *  - saveReview(): write the AI's verdict + the analyzed_count to the
 *    ai_analyses table with type="journal_review".
 *  - listRecentReviews(): return the user's past reviews for the
 *    "history" panel.
 *
 * All three require an authenticated session. RLS guarantees we
 * only ever see the calling user's rows.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserOrThrow } from "@/lib/auth";
import type { TradeRow } from "@/lib/trades/schema";
import type { ReviewVerdict } from "@/lib/journal/schema";
import { parseRecentReview, type RecentReview } from "@/lib/journal/schema";

/**
 * Fetch the user's N most recent CLOSED trades for AI review.
 *
 * - "Closed" = closed_at is not null. Open trades don't have a
 *   realized outcome yet, so they're not useful for pattern analysis.
 * - Ordered by closed_at descending (most recent first).
 * - Returns at most `limit` trades (default 20, capped at 50 by the
 *   route handler).
 *
 * Returns an empty array on failure (the route can still proceed and
 * tell the AI "no closed trades" - the model is told to set verdict
 * to "review" in that case).
 */
export async function fetchTradesForReview(limit = 20): Promise<TradeRow[]> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));

  if (error) {
    console.warn(
      "[journal] fetchTradesForReview failed for user",
      user.id,
      ":",
      error.message,
    );
    return [];
  }
  if (!data) return [];
  return data as unknown as TradeRow[];
}

/**
 * Save a journal-review verdict to the ai_analyses table.
 *
 *  - type           = "journal_review"
 *  - input_summary  = JSON with the analyzed_count + the time window
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
  const supabase = await createSupabaseServerClient();

  const inputSummary = JSON.stringify({
    analyzed_count: args.analyzedCount,
    oldest_closed_at: args.oldestClosedAt,
    newest_closed_at: args.newestClosedAt,
  });

  const { data, error } = await supabase
    .from("ai_analyses")
    .insert({
      user_id: user.id,
      type: "journal_review",
      input_summary: inputSummary,
      output: JSON.stringify(args.verdict),
    })
    .select("id")
    .single();

  if (error) {
    console.warn(
      "[journal] saveReview failed for user",
      user.id,
      ":",
      error.message,
    );
    return null;
  }
  return data?.id ?? null;
}

/**
 * List the user's recent journal reviews (most-recent first).
 *
 * Used by the "Recent reviews" panel in the journal page so the user
 * can revisit past analyses. Each row is parsed into a RecentReview
 * shape (verdict + summary extracted from the JSON output column).
 *
 * Returns at most `limit` rows (default 5). Malformed rows are
 * filtered out by parseRecentReview returning null.
 */
export async function listRecentReviews(limit = 5): Promise<RecentReview[]> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("ai_analyses")
    .select("id, created_at, input_summary, output")
    .eq("type", "journal_review")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(20, limit)));

  if (error) {
    console.warn(
      "[journal] listRecentReviews failed for user",
      user.id,
      ":",
      error.message,
    );
    return [];
  }
  if (!data) return [];

  return (data as Array<{
    id: string;
    created_at: string;
    input_summary: string | null;
    output: string;
  }>)
    .map(parseRecentReview)
    .filter((r): r is RecentReview => r !== null);
}
