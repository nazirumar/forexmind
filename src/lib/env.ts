/**
 * Server-side environment variable validation with zod.
 *
 * IMPORTANT: This module MUST only be imported from server code
 * (Route Handlers, Server Components, server utilities). It reads
 * secrets (GROQ_API_KEY, SUPABASE_SERVICE_ROLE_KEY) that must never
 * reach the browser bundle. Next.js tree-shakes anything imported by
 * client files, but to be safe, do not import this from a file marked
 * "use client".
 *
 * Public env vars (NEXT_PUBLIC_*) are read directly from process.env
 * on the client; they are validated here only for the server-side
 * completeness of the schema.
 */
import { z } from "zod";

const envSchema = z.object({
  // ---- Groq (AI) ----
  GROQ_API_KEY: z
    .string()
    .min(1, "GROQ_API_KEY is required. Get one at https://console.groq.com/keys"),
  GROQ_MODEL_MAIN: z
    .string()
    .min(1)
    .default("llama-3.3-70b-versatile"),
  GROQ_MODEL_FAST: z
    .string()
    .min(1)
    .default("llama-3.1-8b-instant"),

  // ---- Supabase ----
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  // Newer Supabase projects issue a "publishable key"; legacy projects
  // use an "anon key". Either is accepted here.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required"),
  // Legacy name - optional. config.ts falls back to this if the
  // publishable key isn't set, so older .env files keep working.
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required (server-only)"),

  // ---- Market data providers (optional in dev, required in prod) ----
  TWELVE_DATA_API_KEY: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),

  // ---- Node env ----
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parsed & validated environment. Throws a clear, human-readable error
 * if any required variable is missing or malformed, so the app fails
 * fast at boot instead of producing confusing 500s later.
 */
function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `ForexMind: invalid environment configuration.\n` +
        `Fix the following variables in .env.local:\n${issues}`,
    );
  }

  return parsed.data;
}

/**
 * Lazily validated so importing this module never throws at import time
 * (important for tools like vitest that import for types). Accessing
 * `env` for the first time triggers validation.
 */
let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = loadEnv();
  }
  return _env;
}

/**
 * Reset the cached env. Useful for tests that need to swap env values.
 */
export function __resetEnvForTests(): void {
  _env = null;
}
