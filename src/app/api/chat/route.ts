/**
 * POST /api/chat
 *
 * Streaming forex-education chat powered by Groq (llama-3.3-70b-versatile
 * by default, overridable via GROQ_MODEL_MAIN).
 *
 * Flow:
 *  1. Authenticate the caller (401 if no session).
 *  2. Rate-limit per user (AI bucket: 20 req/min burst, 1/sec refill).
 *  3. Validate the request body with zod (max 30 messages, max 4000 chars each).
 *  4. Prepend the system prompt and send to Groq with stream: true.
 *  5. Pipe the token stream into a ReadableStream returned as the response
 *     body, so the browser receives tokens live.
 *
 * Security:
 *  - Server-only. The Groq SDK and API key never reach the browser.
 *  - Auth required (Phase 4). Anonymous callers get 401 before any
 *    Groq tokens are spent.
 *  - Rate-limited per user (Phase 9). Abuse from one account doesn't
 *    starve others.
 *  - Input is validated; oversized payloads are rejected with 400.
 *  - The system prompt enforces "no price predictions, no buy/sell now".
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getGroq, GROQ_MODEL_MAIN, isGroqConfigured } from "@/lib/groq";
import { SYSTEM_PROMPT_CHAT } from "@/lib/prompts";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";

export const runtime = "nodejs";

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
});

export async function POST(req: Request) {
  try {
    // ---- 1. Authenticate ---------------------------------------------
    await getUserOrThrow();

    // ---- 2. Rate limit (per-user AI bucket) --------------------------
    const rl = await enforceRateLimit(req, "ai");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    // ---- 3. Parse & validate body ------------------------------------
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400, headers: rateHeaders },
      );
    }

    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "messages"}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { error: `Invalid request. ${msg}` },
        { status: 400, headers: rateHeaders },
      );
    }

    // ---- 4. Guard: API key configured? ------------------------------
    if (!isGroqConfigured()) {
      return NextResponse.json(
        {
          error:
            "Groq API key is not configured. Set GROQ_API_KEY in .env.local (see .env.example).",
        },
        { status: 503, headers: rateHeaders },
      );
    }

    // ---- 5. Build messages with system prompt -----------------------
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT_CHAT },
      ...parsed.data.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    // ---- 6. Call Groq with streaming ---------------------------------
    type StreamChunk = {
      choices: Array<{ delta?: { content?: string | null } }>;
    };
    let stream: AsyncIterable<StreamChunk>;

    try {
      const created = await getGroq().chat.completions.create({
        model: GROQ_MODEL_MAIN,
        messages,
        stream: true,
        temperature: 0.4,
        max_tokens: 1024,
      });
      stream = created as unknown as AsyncIterable<StreamChunk>;
    } catch (err) {
      return handleGroqError(err, rateHeaders);
    }

    // ---- 7. Pipe tokens into a ReadableStream -----------------------
    const encoder = new TextEncoder();

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              controller.enqueue(encoder.encode(delta));
            }
          }
        } catch (err) {
          const note = "\n\n_[stream interrupted: please try again]_";
          controller.enqueue(encoder.encode(note));
          console.error("[/api/chat] stream error:", err);
        } finally {
          controller.close();
        }
      },
      cancel() {
        // Client disconnected (Stop button or navigation).
      },
    });

    // Streaming responses can't carry the X-RateLimit headers easily
    // (they're set on the initial Response, which we do here).
    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        ...rateHeaders,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/chat] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}

/**
 * Translate Groq SDK errors into friendly HTTP responses.
 * - 401 / invalid key  -> 503 "key not configured properly"
 * - 429 rate limit      -> 429 with a "slow down" message
 * - everything else     -> 500 generic
 */
function handleGroqError(
  err: unknown,
  rateHeaders: Record<string, string>,
): NextResponse {
  const e = err as { status?: number; message?: string; error?: { message?: string } };
  const status = e?.status;
  const message = e?.error?.message || e?.message || "Unknown error";

  if (status === 401 || status === 403) {
    return NextResponse.json(
      {
        error:
          "Groq API key is invalid, unauthorized, or forbidden. Check GROQ_API_KEY in .env.local.",
      },
      { status: 503, headers: rateHeaders },
    );
  }

  if (status === 429) {
    return NextResponse.json(
      {
        error:
          "Rate limit reached on Groq. Please wait a moment and try again.",
      },
      { status: 429, headers: rateHeaders },
    );
  }

  if (status === 503) {
    return NextResponse.json(
      {
        error:
          "Groq service is temporarily unavailable. Please try again shortly.",
      },
      { status: 503, headers: rateHeaders },
    );
  }

  console.error("[/api/chat] Groq error:", message, err);
  return NextResponse.json(
    {
      error:
        "The AI service returned an unexpected error. Please try again in a moment.",
    },
    { status: 502, headers: rateHeaders },
  );
}
