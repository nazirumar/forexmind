/**
 * POST /api/auth/signup
 *   Create a user account + set the session cookie.
 *
 * Body: { email, password, displayName? }
 *
 * Passwords are hashed with scrypt before storage. The session cookie
 * (HMAC-signed) is set on success so the client is immediately logged
 * in without a second request.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, setSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email("Enter a valid email.").toLowerCase().trim(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  displayName: z.string().trim().max(80).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const { email, password, displayName } = parsed.data;

  const passwordHash = await hashPassword(password);
  try {
    const user = await db.user.create({
      data: { email, passwordHash, displayName: displayName || null },
    });
    await setSessionCookie({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    });
    return NextResponse.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
  } catch (err) {
    // Prisma P2002 = unique constraint violation (email already taken).
    if (
      typeof err === "object" && err !== null && "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An account with that email already exists." },
        { status: 409 },
      );
    }
    console.error("[/api/auth/signup] unhandled:", err);
    return NextResponse.json({ error: "Failed to create account." }, { status: 500 });
  }
}
