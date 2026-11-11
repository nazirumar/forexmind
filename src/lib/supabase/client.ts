"use client";

/**
 * Browser Supabase client.
 *
 * Uses the PUBLIC anon key, which is safe to expose: Row Level
 * Security (see supabase/schema.sql) restricts every table to the
 * owning user. Never import SUPABASE_SERVICE_ROLE_KEY here.
 *
 * createBrowserClient() internally caches the instance on `window`,
 * so repeated calls return the same client (important for auth state
 * consistency and for avoiding multiple GoTrue websocket connections).
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";

let cached: SupabaseClient | undefined;

export function createSupabaseBrowserClient(): SupabaseClient {
  if (!cached) {
    cached = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return cached;
}
