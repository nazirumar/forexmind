/**
 * GET /api/profile  - read the user's profile (returns defaults if none)
 * PUT /api/profile  - update the user's profile
 *
 * Both require auth (401 if no session) + are rate-limited.
 */
import { NextResponse } from "next/server";
import { UnauthorizedError, getUserOrThrow, enforceRateLimit } from "@/lib/auth";
import { ProfileError, getProfile, upsertProfile } from "@/lib/profile/queries";
import { profileUpdateSchema } from "@/lib/profile/schema";

export const runtime = "nodejs";

// ---- GET ---------------------------------------------------------------

export async function GET(req: Request) {
  try {
    await getUserOrThrow();

    const rl = await enforceRateLimit(req, "read");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    const profile = await getProfile();
    return NextResponse.json(profile, { headers: rateHeaders });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[/api/profile GET] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}

// ---- PUT --------------------------------------------------------------

export async function PUT(req: Request) {
  try {
    await getUserOrThrow();

    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;
    const rateHeaders = rl.headers;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400, headers: rateHeaders },
      );
    }

    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { error: `Invalid profile: ${msg}` },
        { status: 400, headers: rateHeaders },
      );
    }

    const profile = await upsertProfile(parsed.data);
    return NextResponse.json(profile, { headers: rateHeaders });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ProfileError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/profile PUT] unhandled:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
