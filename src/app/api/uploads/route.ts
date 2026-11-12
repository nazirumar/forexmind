/**
 * POST /api/uploads
 *   Save a chart screenshot to the local filesystem and return its URL.
 *
 * Replaces the Supabase Storage screenshot bucket. The file is written
 * under `public/uploads/<userId>/...` so Next.js serves it as a static
 * asset at `/uploads/<userId>/...` — no signed URLs, no storage SDK.
 *
 * Body: multipart/form-data with:
 *  - file:   the image (png/jpeg/webp)
 *  - which:  "before" | "after" (used in the filename)
 *
 * Auth required. The path is prefixed with the user's id so users can
 * only overwrite their own files (enforced here, not at a storage layer).
 *
 * NOTE: local-FS storage suits self-hosted / dev. On serverless (Vercel)
 * you'd swap the write for an object-storage put — the route signature
 * stays the same.
 */
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getUserOrThrow, enforceRateLimit } from "@/lib/auth";

export const runtime = "nodejs";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function POST(req: Request) {
  try {
    await getUserOrThrow();
    const rl = await enforceRateLimit(req, "write");
    if (!rl.ok) return rl.response;

    const form = await req.formData();
    const file = form.get("file");
    const which = (form.get("which") as string) === "after" ? "after" : "before";

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded (expected a 'file' field)." },
        { status: 400, headers: rl.headers },
      );
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        { error: "Only PNG, JPEG or WebP images are allowed." },
        { status: 415, headers: rl.headers },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Screenshot is too large (max 8 MB)." },
        { status: 413, headers: rl.headers },
      );
    }

    const user = await getUserOrThrow();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const filename = `${Date.now()}-${which}.${ext}`;
    const dir = join(process.cwd(), "public", "uploads", user.id);
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(join(dir, filename), bytes);

    const url = `/uploads/${user.id}/${filename}`;
    return NextResponse.json({ url }, { headers: rl.headers });
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 401) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    console.error("[/api/uploads] unhandled:", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
