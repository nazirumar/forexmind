/**
 * Server-only data-access for the Trade Checker.
 *
 *  - fetchJournalContext(): get the user's recent closed trades from
 *    the trades table. Used to inform the AI's pattern analysis
 *    (e.g. "your last 3 EURUSD trades were losers").
 *  - saveAnalysis(): write the AI's verdict + input summary to the
 *    ai_analyses table with type="trade_check" so the user can
 *    revisit their checks later.
 *
 * Both require an authenticated session. RLS guarantees we only ever
 * see the calling user's rows.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserOrThrow } from "@/lib/auth";
import type { TradeRow } from "@/lib/trades/schema";
import type { CheckVerdict, TradeIdea } from "@/lib/checker/schema";

/**
 * Fetch the user's N most recent closed trades for AI context.
 *
 * - "Closed" = closed_at is not null. Open trades don't tell us
 *   about historical patterns yet.
 * - We return at most 10, with closed_at desc.
 * - Returns an empty array on first use (no journal yet) - the AI
 *   is told about that case explicitly in the prompt.
 */
export async function fetchJournalContext(limit = 10): Promise<TradeRow[]> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(Math.max(1, Math.min(20, limit)));

  if (error) {
    // Don't let a journal-fetch failure break the checker; just log
    // and treat the context as empty. The AI is told it has no
    // journal context in that case.
    console.warn(
      "[checker] fetchJournalContext failed for user",
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
 * Save a trade-check verdict to the ai_analyses table.
 *
 *  - type       = "trade_check"
 *  - input_summary = compact JSON of the trade idea + rules length
 *  - output     = JSON.stringify(verdict)
 *
 * Returns the row id, or null if the save failed (the user still
 * gets their verdict either way; a save failure is non-fatal).
 */
export async function saveAnalysis(args: {
  idea: TradeIdea;
  rules: string;
  verdict: CheckVerdict;
}): Promise<string | null> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const inputSummary = JSON.stringify({
    pair: args.idea.pair,
    direction: args.idea.direction,
    entry: args.idea.entry_price,
    stop_loss: args.idea.stop_loss,
    take_profit: args.idea.take_profit ?? null,
    account_balance: args.idea.account_balance ?? null,
    risk_pct: args.idea.risk_pct ?? null,
    lot_size: args.idea.lot_size ?? null,
    rationale: args.idea.rationale ?? "",
    rules_chars: args.rules.length,
  });

  const { data, error } = await supabase
    .from("ai_analyses")
    .insert({
      user_id: user.id,
      type: "trade_check",
      input_summary: inputSummary,
      output: JSON.stringify(args.verdict),
    })
    .select("id")
    .single();

  if (error) {
    console.warn(
      "[checker] saveAnalysis failed for user",
      user.id,
      ":",
      error.message,
    );
    return null;
  }
  return data?.id ?? null;
}

/**
 * List recent trade-check analyses for the user (most-recent first).
 *
 * Returned by GET /api/checker (list endpoint) so the UI can show a
 * "Recent checks" panel.
 */
export async function listRecentChecks(limit = 10): Promise<
  Array<{
    id: string;
    created_at: string;
    input_summary: string;
    output: string;
  }>
> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("ai_analyses")
    .select("id, created_at, input_summary, output")
    .eq("type", "trade_check")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));

  if (error) {
    console.warn(
      "[checker] listRecentChecks failed for user",
      user.id,
      ":",
      error.message,
    );
    return [];
  }
  if (!data) return [];
  return data as Array<{
    id: string;
    created_at: string;
    input_summary: string;
    output: string;
  }>;
}
