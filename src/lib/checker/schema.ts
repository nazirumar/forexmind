/**
 * Trade Checker - input/output schema + types.
 *
 * The checker is a strict risk manager: the user submits a trade idea
 * + their own written rules + their recent journal trades, and the
 * AI returns a structured verdict flagging violations and warnings.
 *
 * Output is JSON (validated by zod server-side). If the model fails
 * to produce valid JSON we return 502 with a friendly message.
 *
 * IMPORTANT: the verdict field uses three buckets, but NONE of them
 * is a "buy/sell now" command. The model is told to NEVER recommend
 * entering or skipping a trade - it can only say whether rules are
 * met (verdict: "ok_to_proceed") or not (verdict: "skip" / "review").
 * The decision is always the user's.
 */
import { z } from "zod";
import { normalizePair } from "@/lib/risk";

// ---------------------------------------------------------------------------
// Trade idea (input)
// ---------------------------------------------------------------------------

export const tradeIdeaSchema = z.object({
  pair: z
    .string()
    .trim()
    .min(4, "Pair is required.")
    .transform((s) => normalizePair(s)),
  direction: z.enum(["buy", "sell"]),
  entry_price: z
    .number({ error: () => ({ message: "Entry must be a number." }) })
    .positive("Entry must be positive.")
    .max(1_000_000),
  stop_loss: z
    .number({ error: () => ({ message: "Stop loss must be a number." }) })
    .positive("Stop loss must be positive.")
    .max(1_000_000),
  take_profit: z
    .number()
    .positive("Take profit must be positive.")
    .max(1_000_000)
    .optional()
    .nullable(),
  /** Optional account balance for context. */
  account_balance: z
    .number()
    .positive()
    .max(1_000_000_000)
    .optional()
    .nullable(),
  /** Optional risk % the user is considering. */
  risk_pct: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .nullable(),
  /** Optional lot size the user is considering. */
  lot_size: z
    .number()
    .positive()
    .max(10_000)
    .optional()
    .nullable(),
  /** Free-text rationale the user wrote about why they want this trade. */
  rationale: z
    .string()
    .trim()
    .max(2000, "Rationale: keep it under 2000 characters.")
    .optional()
    .default(""),
}).superRefine((val, ctx) => {
  // SL on wrong side of entry for the direction
  const slWrong =
    val.direction === "buy"
      ? val.stop_loss >= val.entry_price
      : val.stop_loss <= val.entry_price;
  if (slWrong) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stop_loss"],
      message:
        val.direction === "buy"
          ? "For a BUY, stop loss must be below entry."
          : "For a SELL, stop loss must be above entry.",
    });
  }
  // TP on wrong side (only if provided)
  if (val.take_profit != null) {
    const tpWrong =
      val.direction === "buy"
        ? val.take_profit <= val.entry_price
        : val.take_profit >= val.entry_price;
    if (tpWrong) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["take_profit"],
        message:
          val.direction === "buy"
            ? "For a BUY, take profit must be above entry."
            : "For a SELL, take profit must be below entry.",
      });
    }
  }
});

export type TradeIdea = z.infer<typeof tradeIdeaSchema>;

// ---------------------------------------------------------------------------
// Check request (input to the API)
// ---------------------------------------------------------------------------

export const checkRequestSchema = z.object({
  idea: tradeIdeaSchema,
  /** User's free-text trading rules. Could be empty. */
  rules: z
    .string()
    .trim()
    .max(4000, "Rules: keep them under 4000 characters.")
    .default(""),
});

export type CheckRequest = z.infer<typeof checkRequestSchema>;

// ---------------------------------------------------------------------------
// Verdict (output)
// ---------------------------------------------------------------------------

/**
 * Severity for a violation or warning.
 *  - high   = clear rule break, e.g. risk > 2% when the rule says ≤ 2%
 *  - medium = softer rule break or repeated pattern, e.g. 3 losers in a row on this pair
 *  - low    = informational, e.g. trade is smaller than typical size
 */
export const severitySchema = z.enum(["high", "medium", "low"]);

export const violationSchema = z.object({
  /** The user's rule that was broken (short phrase). */
  rule: z.string().max(120),
  severity: severitySchema,
  /** One-sentence explanation of how the idea breaks this rule. */
  detail: z.string().max(400),
});

export const checkVerdictSchema = z.object({
  /**
   * - "ok_to_proceed": all rules pass (the model is NOT saying "take
   *   this trade"; it's saying "no rule violations detected").
   * - "review": some rules are unclear or borderline; the user should
   *   think harder before deciding.
   * - "skip": one or more high-severity rules are violated; the model
   *   is NOT saying "don't take this trade"; it's flagging that the
   *   idea breaks the user's own stated rules.
   */
  verdict: z.enum(["ok_to_proceed", "review", "skip"]),
  /** Required: at least one violation when verdict is "skip". */
  violations: z.array(violationSchema).max(10),
  /** Soft warnings (not rule breaks, but worth flagging). */
  warnings: z.array(z.string().max(400)).max(10),
  /** What's good about the setup (one bullet each). */
  strengths: z.array(z.string().max(400)).max(10),
  /** One-paragraph summary, 60-200 words. */
  summary: z.string().min(20).max(800),
  /** Always at least one reminder; the model is told to include risk. */
  reminders: z.array(z.string().max(200)).min(1).max(5),
});

export type CheckVerdict = z.infer<typeof checkVerdictSchema>;
export type Violation = z.infer<typeof violationSchema>;
export type Severity = z.infer<typeof severitySchema>;

/**
 * Wrapper for the API response. Includes the saved analysis id
 * (so the user can revisit it later) and a flag indicating whether
 * the journal context was available.
 */
export const checkResponseSchema = z.object({
  verdict: checkVerdictSchema,
  analysis_id: z.string().uuid().nullable(),
  /** True when the user has at least 5 closed trades in their journal
   *  (the threshold for meaningful pattern analysis). */
  has_journal_context: z.boolean(),
});

export type CheckResponse = z.infer<typeof checkResponseSchema>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Map verdict -> Tailwind-friendly color token + label. */
export function verdictMeta(v: CheckVerdict["verdict"]): {
  label: string;
  color: "emerald" | "amber" | "rose";
  blurb: string;
} {
  switch (v) {
    case "ok_to_proceed":
      return {
        label: "Rules check passed",
        color: "emerald",
        blurb: "No rule violations detected. The decision is still yours.",
      };
    case "review":
      return {
        label: "Needs your review",
        color: "amber",
        blurb: "Some rules are borderline or unclear. Re-read them and your journal.",
      };
    case "skip":
      return {
        label: "Rules violated",
        color: "rose",
        blurb: "One or more of your own rules is broken. The decision is still yours.",
      };
  }
}

/** Severity -> color token + label. */
export function severityMeta(s: Severity): {
  label: string;
  color: "rose" | "amber" | "slate";
} {
  switch (s) {
    case "high":
      return { label: "High", color: "rose" };
    case "medium":
      return { label: "Medium", color: "amber" };
    case "low":
      return { label: "Low", color: "slate" };
  }
}
