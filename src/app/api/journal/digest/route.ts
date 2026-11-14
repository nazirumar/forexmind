/**
 * /api/journal/digest
 *   POST   - generate a weekly AI performance digest (on demand).
 *   GET    - the latest SAVED weekly digest (scheduled or on-demand).
 *
 * POST flow:
 *  1. Auth + rate-limit (AI bucket).
 *  2. Parse optional from/to date range (default: last 7 days).
 *  3. generateWeeklyDigest() in @/lib/journal/generate-digest does the
 *     real work (trades -> patterns -> Groq -> save ai_analyses).
 *  4. Return { id, summary, insights, question, patterns, ... }.
 *
 * GET flow (read-back):
 *  Returns the user's most recent saved weekly digest. This is how
 *  scheduled reviews (run by /api/cron/weekly-review while you were
 *  away) surface in the journal panel. 200 with { digest: null } when
 *  none exists yet.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import {
  digestRequestSchema,
  digestResponseSchema,
} from "@/lib/journal/schema";
import {
  generateWeeklyDigest,
  fetchLatestWeeklyDigest,
} from "@/lib/journal/generate-digest";

export const runtime = "nodejs";

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

    const user = await getUserOrThrow();
    try {
      const { response, usedFallback } = await generateWeeklyDigest(
        user.id,
        from,
        to,
      );

      // Validate our own response shape.
      const safe = digestResponseSchema.safeParse(response);
      if (!safe.success) {
        console.error("[/api/journal/digest] response shape mismatch:", safe.error);
        return NextResponse.json(
          { error: "Internal: response shape mismatch." },
          { status: 500, headers: rateHeaders },
        );
      }

      return NextResponse.json(safe.data, {
        headers: { ...rateHeaders, "X-Digest-Fallback": usedFallback ? "1" : "0" },
      });
    } catch (err) {
      console.error("[/api/journal/digest] generation failed:", err);
      return NextResponse.json(
        { error: "AI service unavailable. Please try again." },
        { status: 502, headers: rateHeaders },
      );
    }
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

export async function GET(req: Request) {
  try {
    const user = await getUserOrThrow();
    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;

    const digest = await fetchLatestWeeklyDigest(user.id);
    if (!digest) return NextResponse.json({ digest: null }, { headers: rl.headers });

    const safe = digestResponseSchema.safeParse(digest);
    if (!safe.success) {
      console.error("[/api/journal/digest GET] shape mismatch:", safe.error);
      return NextResponse.json({ digest: null }, { headers: rl.headers });
    }
    return NextResponse.json({ digest: safe.data }, { headers: rl.headers });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/journal/digest GET] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
