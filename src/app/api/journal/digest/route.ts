/**
 * POST /api/journal/digest
 *   Generate a weekly AI performance digest.
 *
 * Flow:
 *  1. Auth + rate-limit (AI bucket).
 *  2. Parse optional from/to date range (default: last 7 days).
 *  3. Fetch the user's trades in that window.
 *  4. Run detectPatterns() (deterministic).
 *  5. Build the DATA block and send to Groq (best-effort; if Groq
 *     isn't configured, return the patterns with a stub summary).
 *  6. Save to ai_analyses with type="weekly_digest".
 *  7. Return { id, summary, insights, question, patterns, ... }.
 */
import { NextResponse } from "next/server";
import { getGroq, GROQ_MODEL_MAIN, isGroqConfigured } from "@/lib/groq";
import { SYSTEM_PROMPT_WEEKLY_DIGEST } from "@/lib/prompts";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { digestRequestSchema, digestResponseSchema, type DigestResponse } from "@/lib/journal/schema";
import { detectPatterns, buildDigestDataBlock } from "@/lib/journal/digest-patterns";
import { tradeRowSchema, type TradeRow } from "@/lib/trades/schema";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";

export const runtime = "nodejs";

const MIN_TRADES_FOR_DIGEST = 3;

export async function POST(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "ai");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    const body = await req.json().catch(() => ({}));
    const parsed = digestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400, headers: rateHeaders },
      );
    }

    const now = new Date();
    const to = parsed.data.to ? new Date(parsed.data.to) : now;
    const from = parsed.data.from
      ? new Date(parsed.data.from)
      : new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    if (from > to) {
      return NextResponse.json(
        { error: "'from' must be before 'to'." },
        { status: 400, headers: rateHeaders },
      );
    }

    // Fetch trades in the window.
    const user = await getUserOrThrow();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", user.id)
      .gte("opened_at", from.toISOString())
      .lte("opened_at", to.toISOString())
      .order("opened_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load trades: ${error.message}` },
        { status: 500, headers: rateHeaders },
      );
    }

    const trades: TradeRow[] = (data ?? []).map((d) => tradeRowSchema.parse(d));
    const patterns = detectPatterns(trades);
    const windowStart = from.toISOString();
    const windowEnd = to.toISOString();

    const hasEnough = trades.filter((t) => t.pnl != null).length >= MIN_TRADES_FOR_DIGEST;

    // Build the AI message.
    const dataBlock = buildDigestDataBlock(trades, patterns, windowStart, windowEnd);
    const userMessage: ChatCompletionMessageParam = {
      role: "user",
      content: dataBlock,
    };

    let summary: string;
    let insights: string[];
    let question: string;
    let analysisId: string | null = null;

    if (isGroqConfigured()) {
      try {
        const groq = getGroq();
        const completion = await groq.chat.completions.create({
          model: GROQ_MODEL_MAIN,
          messages: [
            { role: "system", content: SYSTEM_PROMPT_WEEKLY_DIGEST },
            userMessage,
          ],
          response_format: { type: "json_object" },
          temperature: 0.4,
          max_tokens: 800,
        });
        const raw = completion.choices[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(raw) as {
          summary?: string;
          insights?: unknown;
          question?: string;
        };
        summary = typeof parsed.summary === "string" ? parsed.summary : "";
        insights = Array.isArray(parsed.insights)
          ? parsed.insights.filter((x): x is string => typeof x === "string").slice(0, 3)
          : [];
        question = typeof parsed.question === "string" ? parsed.question : "";
      } catch (err) {
        console.error("[/api/journal/digest] Groq error:", err);
        return NextResponse.json(
          { error: "AI service unavailable. Please try again." },
          { status: 502, headers: rateHeaders },
        );
      }
    } else {
      // No Groq - return the deterministic patterns with a stub.
      summary = hasEnough
        ? `${trades.filter((t) => t.pnl != null).length} trades in the window. See the detected patterns below.`
        : "Not enough closed trades in this window for a meaningful digest.";
      insights = [];
      question = "What was your biggest recurring pattern this week?";
    }

    // Save to ai_analyses (best-effort).
    const output = JSON.stringify({ summary, insights, question });
    try {
      const { data: saved } = await supabase
        .from("ai_analyses")
        .insert({
          user_id: user.id,
          type: "weekly_digest",
          input_summary: dataBlock.slice(0, 2000),
          output,
        })
        .select("id")
        .single();
      analysisId = saved?.id ?? null;
    } catch (err) {
      console.warn("[/api/journal/digest] save failed:", err);
    }

    const response: DigestResponse = {
      id: analysisId,
      window_start: windowStart,
      window_end: windowEnd,
      analyzed_count: trades.length,
      has_enough_data: hasEnough,
      summary,
      insights,
      question,
      patterns: patterns.map((p) => ({ key: p.key, statement: p.statement })),
    };

    // Validate our own response shape.
    const safe = digestResponseSchema.safeParse(response);
    if (!safe.success) {
      console.error("[/api/journal/digest] response shape mismatch:", safe.error);
      return NextResponse.json(
        { error: "Internal: response shape mismatch." },
        { status: 500, headers: rateHeaders },
      );
    }

    return NextResponse.json(safe.data, { headers: rateHeaders });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/journal/digest] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
