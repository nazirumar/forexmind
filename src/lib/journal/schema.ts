/**
 * AI Journal Review - input/output schema + types.
 *
 * The review takes the user's recent closed trades (server-injected)
 * + the analytics summary (computed server-side from those trades),
 * and returns a structured "patterns I noticed" analysis.
 *
 * The verdict field uses the same vocabulary as the trade checker:
 *  - "ok_to_proceed" = enough data + patterns are clear enough to share
 *  - "review"        = not enough data (<5 closed trades) or too noisy
 *
 * IMPORTANT: the AI is told NEVER to say "you should" or "you must".
 * The patterns are observations, not commands. The questions are
 * open-ended reflection prompts, not instructions.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Request (client -> server)
// ---------------------------------------------------------------------------

/**
 * The request is intentionally minimal: the server fetches the user's
 * trades and computes the analytics itself. The client doesn't send
 * trade data (avoids tampering + keeps the payload small).
 *
 * Optional `limit` lets the client request a specific window (default
 * 20, capped at 50 by the route handler).
 */
export const reviewRequestSchema = z.object({
  limit: z
    .number()
    .int()
    .min(5)
    .max(50)
    .optional()
    .default(20),
});

export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

// ---------------------------------------------------------------------------
// Verdict (server -> client)
// ---------------------------------------------------------------------------

export const patternTypeSchema = z.enum(["strength", "weakness", "neutral"]);

export const patternSchema = z.object({
  type: patternTypeSchema,
  /** Short label, 3-8 words. E.g. "Strong London session performance". */
  title: z.string().min(3).max(80),
  /** 2-3 sentence explanation WITH specific numbers from the data. */
  detail: z.string().min(10).max(400),
});

export const reviewVerdictSchema = z.object({
  /** "ok_to_proceed" = enough data + patterns clear. "review" = too little data. */
  verdict: z.enum(["ok_to_proceed", "review"]),
  /** 3-8 pattern observations, each citing specific numbers. */
  patterns: z.array(patternSchema).min(1).max(10),
  /** 1-3 open-ended reflection questions. NOT commands. */
  questions: z.array(z.string().min(5).max(300)).min(1).max(5),
  /** One paragraph, 80-200 words, citing the most important pattern. */
  summary: z.string().min(20).max(1000),
  /** Always at least one risk reminder. */
  reminders: z.array(z.string().min(5).max(300)).min(1).max(5),
});

export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type Pattern = z.infer<typeof patternSchema>;
export type PatternType = z.infer<typeof patternTypeSchema>;

/**
 * Full API response. Includes the saved analysis id + the count of
 * trades that were analyzed (so the UI can show "based on your last
 * N closed trades").
 */
export const reviewResponseSchema = z.object({
  verdict: reviewVerdictSchema,
  analysis_id: z.string().uuid().nullable(),
  /** Number of closed trades analyzed. May be < request.limit if the
   *  user has fewer trades in their journal. */
  analyzed_count: z.number().int().min(0),
  /** True when analyzed_count >= 5 (the threshold for meaningful
   *  pattern analysis). */
  has_enough_data: z.boolean(),
});

export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

// ---------------------------------------------------------------------------
// Recent review (list endpoint)
// ---------------------------------------------------------------------------

/**
 * One row in the "recent reviews" list. Returned by
 * listRecentReviews() - a thin wrapper around the ai_analyses table
 * filtered by type="journal_review".
 */
export type RecentReview = {
  id: string;
  created_at: string;
  /** Number of trades analyzed (parsed from input_summary). */
  analyzed_count: number;
  /** The verdict (parsed from output JSON). */
  verdict: "ok_to_proceed" | "review";
  /** The summary paragraph (parsed from output JSON). */
  summary: string;
};

/**
 * Parse a raw ai_analyses row (type="journal_review") into a
 * RecentReview. Returns null if parsing fails (malformed data).
 * Pure.
 */
export function parseRecentReview(row: {
  id: string;
  created_at: string;
  input_summary: string | null;
  output: string;
}): RecentReview | null {
  try {
    const input = JSON.parse(row.input_summary ?? "{}") as {
      analyzed_count?: number;
    };
    const output = JSON.parse(row.output) as {
      verdict?: string;
      summary?: string;
    };
    if (!output.verdict || !output.summary) return null;
    return {
      id: row.id,
      created_at: row.created_at,
      analyzed_count: input.analyzed_count ?? 0,
      verdict: output.verdict as "ok_to_proceed" | "review",
      summary: output.summary,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function patternTypeMeta(t: PatternType): {
  label: string;
  color: "emerald" | "rose" | "slate";
  icon: "check" | "alert" | "info";
} {
  switch (t) {
    case "strength":
      return { label: "Strength", color: "emerald", icon: "check" };
    case "weakness":
      return { label: "Weakness", color: "rose", icon: "alert" };
    case "neutral":
      return { label: "Observation", color: "slate", icon: "info" };
  }
}
