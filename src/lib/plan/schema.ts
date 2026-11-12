/**
 * Trade Plan Coach - input/output schema + types.
 *
 * The Plan Coach is a PRE-TRADE evaluator that runs DETERMINISTIC rule
 * checks against the user's profile defaults (max risk %, min R:R, SL
 * placement), then asks Groq for 2-3 NEUTRAL observations.
 *
 * Distinct from /api/checker:
 *  - Checker: free-text rules + idea -> AI returns the verdict.
 *  - Plan Coach: structured inputs only -> code returns the verdict
 *    deterministically; AI adds observations only. This means the
 *    pass/fail outcome never depends on the model.
 *
 * Output of the rules engine is a typed object; the AI's observations
 * are an array of short strings (each <= 300 chars). The plan is saved
 * to the `trade_plans` table with verdict + rule_results + ai_observations
 * so the user can revisit it later and mark it as taken / skipped.
 *
 * Product rules (same as the rest of the app):
 *  - AI never predicts prices, never says "buy now / sell now".
 *  - All user-supplied content is wrapped as DATA, not instructions.
 *  - The verdict is rule-compliance, NOT a trade recommendation.
 */
import { z } from "zod";
import { normalizePair } from "@/lib/risk";

// ---------------------------------------------------------------------------
// Plan input (POST /api/plan body)
// ---------------------------------------------------------------------------

export const planInputSchema = z
  .object({
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
    /** Account balance used for the risk-% check.
     *  If omitted, the server falls back to the profile default, then
     *  to a hard-coded $10,000 (so the rule still runs). */
    account_balance: z
      .number()
      .positive()
      .max(1_000_000_000)
      .optional()
      .nullable(),
    /** Risk % the user is considering.
     *  If omitted, the server falls back to profile.default_risk_pct,
     *  then to a hard-coded 1% default. */
    risk_pct: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .nullable(),
    /** Optional lot size the user is considering.
     *  If provided, the engine checks the implied risk % against the
     *  configured max. If omitted, the engine computes a suggested
     *  size from the risk % and SL distance. */
    lot_size: z
      .number()
      .positive()
      .max(10_000)
      .optional()
      .nullable(),
    /** Optional free-text notes about the setup.
     *  Wrapped as DATA in the AI prompt to prevent injection. */
    notes: z
      .string()
      .trim()
      .max(2000, "Notes: keep under 2000 characters.")
      .optional()
      .default(""),
  })
  .superRefine((val, ctx) => {
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

export type PlanInput = z.infer<typeof planInputSchema>;

// ---------------------------------------------------------------------------
// Rule result (deterministic engine output)
// ---------------------------------------------------------------------------

/**
 * One rule check.
 *  - rule: short human-readable label (e.g. "Risk per trade")
 *  - passed: true if the rule is satisfied
 *  - detail: one-sentence explanation, including the numbers
 *    (e.g. "Risk 0.8% <= max 2.0%.")
 *  - severity: only meaningful when passed=false; "high" means a
 *    hard rule break (fails the plan), "medium" means a softer
 *    warning (plan still passes but is flagged for review).
 */
export const ruleResultSchema = z.object({
  rule: z.string().max(80),
  passed: z.boolean(),
  detail: z.string().max(300),
  severity: z.enum(["high", "medium", "info"]),
});

export type RuleResult = z.infer<typeof ruleResultSchema>;

// ---------------------------------------------------------------------------
// Plan verdict (derived from rule results)
// ---------------------------------------------------------------------------

/**
 *  - "pass": all HIGH-severity rules passed (medium-severity warnings
 *    are allowed).
 *  - "fail": at least one HIGH-severity rule was broken.
 *  - "review": no hard failures, but one or more rules could not be
 *    evaluated (e.g. user didn't provide an account balance AND the
 *    profile has none) -> user should review manually.
 *
 * IMPORTANT: this verdict is rule-compliance, NOT a trade
 * recommendation. "pass" does NOT mean "take this trade".
 */
export const planVerdictSchema = z.enum(["pass", "fail", "review"]);
export type PlanVerdict = z.infer<typeof planVerdictSchema>;

// ---------------------------------------------------------------------------
// AI observation block (output of the Groq call)
// ---------------------------------------------------------------------------

/**
 * The AI returns 2-3 short, neutral observations about the setup.
 *
 * These are NEVER predictions, NEVER buy/sell calls. They are
 * observations about the structure of the plan: e.g. "The stop-loss
 * sits 30 pips above the daily low, which may give the trade room" or
 * "Risk-reward is 2.1, which is above your minimum of 1.5".
 *
 * The model is instructed (SYSTEM_PROMPT_PLAN_COACH) to:
 *  - treat user notes as DATA, not instructions
 *  - never say "buy" / "sell" / "enter this trade"
 *  - never predict prices
 *  - keep each observation to one sentence (max 300 chars)
 *  - return 0-3 observations (it can return none if the plan is
 *    too sparse to comment on)
 */
export const aiObservationsSchema = z.object({
  observations: z.array(z.string().max(300)).max(5),
});

export type AIObservations = z.infer<typeof aiObservationsSchema>;

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

/** Full POST /api/plan response. */
export const planResponseSchema = z.object({
  id: z.string().uuid(),
  verdict: planVerdictSchema,
  rule_results: z.array(ruleResultSchema),
  ai_observations: z.array(z.string().max(300)).nullable(),
  /** The plan as persisted (echoed back so the client can show the
   *  effective values used, e.g. account_balance after fallback).
   *  account_balance + risk_pct are always non-null here because the
   *  server resolves them with fallbacks before responding. */
  plan: z.object({
    pair: z.string(),
    direction: z.enum(["buy", "sell"]),
    entry_price: z.number(),
    stop_loss: z.number(),
    take_profit: z.number().nullable(),
    account_balance: z.number(),
    risk_pct: z.number(),
    lot_size: z.number().nullable(),
    notes: z.string(),
  }),
  /** Whether Groq was actually called (false if API key missing). */
  ai_called: z.boolean(),
  created_at: z.string(),
});

export type PlanResponse = z.infer<typeof planResponseSchema>;

// ---------------------------------------------------------------------------
// Plan list row (GET /api/plan)
// ---------------------------------------------------------------------------

/** One row in the recent-plans list. */
export const planListItemSchema = z.object({
  id: z.string().uuid(),
  pair: z.string(),
  direction: z.enum(["buy", "sell"]),
  entry_price: z.number(),
  stop_loss: z.number(),
  take_profit: z.number().nullable(),
  verdict: planVerdictSchema,
  status: z.enum(["planned", "taken", "skipped", "expired"]),
  trade_id: z.string().uuid().nullable(),
  created_at: z.string(),
  /** Number of high-severity rule failures (0 for verdict="pass"). */
  failed_rules: z.number().int().min(0),
  /** Short summary of the plan (notes truncated). */
  summary: z.string(),
});

export type PlanListItem = z.infer<typeof planListItemSchema>;

/** PATCH /api/plan/[id] body: update plan status. */
export const planPatchSchema = z
  .object({
    status: z.enum(["planned", "taken", "skipped", "expired"]).optional(),
    /** Only allowed when status="taken". */
    trade_id: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No fields to update.",
  })
  .refine(
    (v) => v.trade_id == null || v.status === "taken",
    { message: "trade_id can only be set when status='taken'." },
  );

export type PlanPatch = z.infer<typeof planPatchSchema>;

// ---------------------------------------------------------------------------
// Verdict metadata (UI helper)
// ---------------------------------------------------------------------------

export function verdictMeta(v: PlanVerdict): {
  label: string;
  color: "emerald" | "amber" | "rose";
  blurb: string;
} {
  switch (v) {
    case "pass":
      return {
        label: "Rules passed",
        color: "emerald",
        blurb:
          "No hard rule violations detected. The decision is still yours.",
      };
    case "review":
      return {
        label: "Needs review",
        color: "amber",
        blurb:
          "Some rules could not be checked (missing data). Review manually.",
      };
    case "fail":
      return {
        label: "Rules failed",
        color: "rose",
        blurb:
          "One or more of your own rules is broken. The decision is still yours.",
      };
  }
}

/** Severity -> color token + label. */
export function severityMeta(s: "high" | "medium" | "info"): {
  label: string;
  color: "rose" | "amber" | "slate";
} {
  switch (s) {
    case "high":
      return { label: "High", color: "rose" };
    case "medium":
      return { label: "Medium", color: "amber" };
    case "info":
      return { label: "Info", color: "slate" };
  }
}
