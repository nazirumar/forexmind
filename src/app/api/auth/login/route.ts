/**
 * POST /api/auth/login
 *   Verify credentials + set the session cookie.
 *
 * Body: { email, password }
 *
 * Returns 401 with a generic "Invalid email or password" for both
 * unknown-email and wrong-password so an attacker can't enumerate
 * accounts by distinguishing the two responses.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword, setSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
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
      { error: "Enter your email and password." },
      { status: 400 },
    );
  }
  const { email, password } = parsed.data;

  const user = await db.user.findUnique({ where: { email } });
  // Always run a hash check (against a dummy hash when the user is
  // absent) so the response time doesn't leak whether the email exists.
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, "scrypt:dummy:dummy").catch(() => false);

  if (!user || !ok) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 },
    );
  }

  await setSessionCookie({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  });
  return NextResponse.json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
  });
}
