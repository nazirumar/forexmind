/**
 * Auth helpers for Route Handlers.
 *
 * getUserOrThrow() is the standard way every protected /api/* route
 * authenticates the caller (spec Phase 4, item 4). It returns the
 * Supabase user or throws UnauthorizedError; the route catches it and
 * returns a 401 JSON response.
 *
 * Typical usage in a Route Handler:
 *
 *   import { NextResponse } from "next/server";
 *   import { getUserOrThrow, UnauthorizedError } from "@/lib/auth";
 *
 *   export async function GET() {
 *     try {
 *       const user = await getUserOrThrow();
 *       // user.id is the scope for all queries.
 *     } catch (err) {
 *       if (err instanceof UnauthorizedError) {
 *         return NextResponse.json({ error: err.message }, { status: 401 });
 *       }
 *       throw err; // let the framework's error handler respond 500
 *     }
 *   }
 */
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

export type { SessionUser };

export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = "Authentication required. Please sign in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Returns the authenticated user, or throws UnauthorizedError (401).
 * Reads the HMAC-signed session cookie and verifies its signature
 * server-side (no external auth service call).
 */
export async function getUserOrThrow(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

/**
 * Convenience wrapper that returns `null` instead of throwing.
 * Useful when auth is optional (e.g. rendering a header).
 */
export async function getUserOrNull(): Promise<SessionUser | null> {
  return getSessionUser();
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import {
  rateLimitCheck,
  rateLimitHeaders,
  type RateLimitKind,
  type RateLimitResult,
} from "@/lib/rate-limit";

/**
 * Outcome of a `enforceRateLimit` call.
 *  - `ok`     -> caller should proceed; attach `headers` to the response.
 *  - `blocked`-> caller should immediately return `response` (HTTP 429).
 */
type EnforceOutcome =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: NextResponse };

/**
 * Enforce a per-user rate limit on a route handler.
 *
 * Usage:
 *
 *   const rl = await enforceRateLimit(req, "ai");
 *   if (!rl.ok) return rl.response;
 *   // ... proceed; attach rl.headers to your success response.
 *
 * For authenticated routes the bucket key is `user.id`; for public
 * routes (no session) we fall back to the caller's IP via
 * `x-forwarded-for`. This keeps crawlers off the public endpoints
 * without forcing every reader to sign in.
 *
 * In the sandbox (no real Supabase), every anonymous caller shares
 * the same `ip:anon` bucket, so the limit IS still enforced - just
 * coarser than per-user. With real keys in prod, each user gets
 * their own bucket.
 */
export async function enforceRateLimit(
  req: Request,
  kind: RateLimitKind,
): Promise<EnforceOutcome> {
  // Try to identify the caller: prefer user.id, fall back to IP.
  let key: string;
  const user = await getUserOrNull();
  if (user) {
    key = `u:${user.id}`;
  } else {
    const xff = req.headers.get("x-forwarded-for");
    const ip = xff ? xff.split(",")[0]!.trim() : "anon";
    key = `ip:${ip}`;
  }

  const result: RateLimitResult = rateLimitCheck(key, kind);
  const headers = rateLimitHeaders(result);

  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Rate limit reached. Please slow down and try again in a moment.",
        },
        { status: 429, headers },
      ),
    };
  }

  return { ok: true, headers };
}
