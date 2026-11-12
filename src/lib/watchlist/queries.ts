/**
 * Server-only data access for watchlist + price alerts.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserOrThrow } from "@/lib/auth";
import {
  alertRowSchema,
  watchlistRowSchema,
  type AlertAdd,
  type AlertRow,
  type WatchlistAdd,
  type WatchlistRow,
} from "@/lib/watchlist/schema";

export class WatchlistError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "WatchlistError";
    this.status = status;
  }
}

async function context() {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}

// --- Watchlist ---

export async function listWatchlist(): Promise<WatchlistRow[]> {
  const { user, supabase } = await context();
  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new WatchlistError(500, error.message);
  return (data ?? []) as unknown as WatchlistRow[];
}

export async function addWatchlistItem(input: WatchlistAdd): Promise<WatchlistRow> {
  const { user, supabase } = await context();
  const { data, error } = await supabase
    .from("watchlist")
    .upsert(
      { user_id: user.id, pair: input.pair },
      { onConflict: "user_id,pair" },
    )
    .select()
    .single();
  if (error) throw new WatchlistError(500, error.message);
  if (!data) throw new WatchlistError(500, "Insert returned no row.");
  return watchlistRowSchema.parse(data);
}

export async function removeWatchlistItem(id: string): Promise<void> {
  const { user, supabase } = await context();
  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new WatchlistError(500, error.message);
}

// --- Alerts ---

export async function listAlerts(): Promise<AlertRow[]> {
  const { user, supabase } = await context();
  const { data, error } = await supabase
    .from("price_alerts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw new WatchlistError(500, error.message);
  return (data ?? []) as unknown as AlertRow[];
}

export async function addAlert(input: AlertAdd): Promise<AlertRow> {
  const { user, supabase } = await context();
  const { data, error } = await supabase
    .from("price_alerts")
    .insert({
      user_id: user.id,
      pair: input.pair,
      direction: input.direction,
      threshold: input.threshold,
      active: true,
    })
    .select()
    .single();
  if (error) throw new WatchlistError(500, error.message);
  if (!data) throw new WatchlistError(500, "Insert returned no row.");
  return alertRowSchema.parse(data);
}

export async function deleteAlert(id: string): Promise<void> {
  const { user, supabase } = await context();
  const { error } = await supabase
    .from("price_alerts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new WatchlistError(500, error.message);
}
