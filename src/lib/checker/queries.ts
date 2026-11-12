/**
 * Server-only data-access for the Trade Checker (Neon Postgres via Prisma).
 *
 *  - fetchJournalContext(): get the user's recent closed trades from
 *    the trades table. Used to inform the AI's pattern analysis
 *    (e.g. "your last 3 EURUSD trades were losers").
 *  - saveAnalysis(): write the AI's verdict + input summary to the
 *    ai_analyses table with type="trade_check" so the user can revisit
 *    their checks later.
 *  - listRecentChecks(): list recent trade-check analyses for the user.
 *
 * All require an authenticated session. There is no RLS anymore (that
 * was a Supabase feature), so EVERY query explicitly filters by
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
import type { CheckVerdict, TradeIdea } from "@/lib/checker/schema";

/**
 * Fetch the user's N most recent closed trades for AI context.
 *
 * - "Closed" = closedAt is not null. Open trades don't tell us about
 *   historical patterns yet.
 * - We return at most 10 (capped at 20), with closedAt desc.
 * - Returns an empty array on first use (no journal yet) - the AI is
 *   told about that case explicitly in the prompt.
 */
export async function fetchJournalContext(limit = 10): Promise<TradeRow[]> {
  const user = await getUserOrThrow();
  try {
    const trades = await db.trade.findMany({
      where: { userId: user.id, closedAt: { not: null } },
      orderBy: { closedAt: "desc" },
      take: Math.max(1, Math.min(20, limit)),
    });
    return trades.map(toTradeRow);
  } catch (err) {
    // Don't let a journal-fetch failure break the checker; just log
    // and treat the context as empty. The AI is told it has no
    // journal context in that case.
    console.warn(
      "[checker] fetchJournalContext failed for user",
      user.id,
      ":",
      errMessage(err),
    );
    return [];
  }
}

/**
 * Save a trade-check verdict to the ai_analyses table.
 *
 *  - type          = "trade_check"
 *  - inputSummary  = compact JSON of the trade idea + rules length
 *  - output        = JSON.stringify(verdict)
 *
 * Returns the row id, or null if the save failed (the user still gets
 * their verdict either way; a save failure is non-fatal).
 */
export async function saveAnalysis(args: {
  idea: TradeIdea;
  rules: string;
  verdict: CheckVerdict;
}): Promise<string | null> {
  const user = await getUserOrThrow();
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
  try {
    const created = await db.aiAnalysis.create({
      data: {
        userId: user.id,
        type: "trade_check",
        inputSummary,
        output: JSON.stringify(args.verdict),
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    console.warn(
      "[checker] saveAnalysis failed for user",
      user.id,
      ":",
      errMessage(err),
    );
    return null;
  }
}

/**
 * List recent trade-check analyses for the user (most-recent first).
 *
 * Returned by GET /api/checker (list endpoint) so the UI can show a
 * "Recent checks" panel. Prisma returns createdAt as a Date and
 * inputSummary as `string | null`; we convert createdAt → ISO string
 * and coerce null inputSummary → "" to match the declared row shape.
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
  try {
    const rows = await db.aiAnalysis.findMany({
      where: { userId: user.id, type: "trade_check" },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(50, limit)),
      select: { id: true, createdAt: true, inputSummary: true, output: true },
    });
    return rows.map((r) => ({
      id: r.id,
      created_at: r.createdAt.toISOString(),
      input_summary: r.inputSummary ?? "",
      output: r.output,
    }));
  } catch (err) {
    console.warn(
      "[checker] listRecentChecks failed for user",
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
