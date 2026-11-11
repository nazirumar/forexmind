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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = "Authentication required. Please sign in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Returns the authenticated user, or throws UnauthorizedError (401).
 * Trustworthy: it validates the JWT server-side via Supabase
 * (supabase.auth.getUser), not just reads the cookie payload.
 */
export async function getUserOrThrow(): Promise<User> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new UnauthorizedError();
  }

  return data.user;
}

/**
 * Convenience wrapper that returns `null` instead of throwing.
 * Useful when auth is optional (e.g. rendering a header).
 */
export async function getUserOrNull(): Promise<User | null> {
  try {
    return await getUserOrThrow();
  } catch {
    return null;
  }
}
