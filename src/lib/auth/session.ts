/**
 * Session-based auth on Neon Postgres (replaces Supabase Auth).
 *
 * - Passwords hashed with Node's scrypt (built-in, no native deps).
 * - Session = an HMAC-signed JSON token in an httpOnly cookie. No
 *   session table lookups per request: the token is verified by
 *   recomputing the HMAC with AUTH_SECRET, so it can't be tampered
 *   with but carries the user id + email for the request.
 * - `getSessionUser()` is the single read path used by auth.ts.
 *
 * Why not JWT lib: a 20-line HMAC token does everything we need
 * (signed, verifiable, no external dep) and is trivial to audit.
 */
import { cookies } from "next/headers";
import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = "forexmind_session";
/** 30 days, in seconds. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export type SessionUser = {
  id: string;
  email: string;
  displayName?: string | null;
};

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. Add a random >=32-char string to .env.local.",
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

/**
 * Hash a password with scrypt + a per-hash salt. Returns
 * "scrypt:<salt>:<derived>" (both base64). Stored on User.passwordHash.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString("base64url")}`;
}

/**
 * Verify a password against a "scrypt:<salt>:<derived>" hash.
 * Constant-time comparison via timingSafeEqual.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedB64] = parts;
  if (!salt || !expectedB64) return false;
  const expected = Buffer.from(expectedB64, "base64url");
  const derived = await scrypt(password, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// ---------------------------------------------------------------------------
// Signed session token
// ---------------------------------------------------------------------------

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function unb64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

function sign(payload: string): string {
  const mac = createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

/**
 * Create a signed session token for a user.
 */
export function createSessionToken(user: SessionUser): string {
  const payload = JSON.stringify({
    uid: user.id,
    email: user.email,
    name: user.displayName ?? null,
    iat: Date.now(),
  });
  return sign(b64url(payload));
}

/**
 * Verify a session token's signature and return the user, or null if
 * the token is missing, malformed, or has a bad signature.
 */
export function verifySessionToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expectedMac = createHmac("sha256", getAuthSecret())
    .update(payloadB64)
    .digest("base64url");
  // Constant-time compare.
  const a = Buffer.from(mac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(unb64url(payloadB64)) as {
      uid: string; email: string; name?: string | null;
    };
    if (!payload.uid || !payload.email) return null;
    return { id: payload.uid, email: payload.email, displayName: payload.name ?? null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie read / write (server-side, via next/headers)
// ---------------------------------------------------------------------------

/**
 * Set the session cookie for `user`. Call from the login/signup route
 * after the user is authenticated.
 */
export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = createSessionToken(user);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Clear the session cookie (logout). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/**
 * Read + verify the session cookie. Returns the user, or null when
 * there is no session or the signature is invalid.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}
