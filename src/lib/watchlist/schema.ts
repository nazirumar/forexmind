/**
 * Watchlist + Price Alerts - schema, types, pure helpers.
 *
 *  - WatchlistItem: a pair the user watches.
 *  - PriceAlert: a threshold alert ("notify when EURUSD >= 1.10").
 *  - checkAlert(): pure predicate — does a given rate trigger the alert?
 *
 * No DB access here. The queries module handles persistence.
 */
import { z } from "zod";
import { normalizePair } from "@/lib/risk";
import { PAIRS } from "@/lib/trades/schema";

// Re-export so callers can import from one place.
export { PAIRS };

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export const watchlistAddSchema = z.object({
  pair: z
    .string()
    .trim()
    .min(4)
    .transform((s) => normalizePair(s))
    .refine((p) => (PAIRS as readonly string[]).includes(p), {
      message: "Unsupported pair.",
    }),
});

export type WatchlistAdd = z.infer<typeof watchlistAddSchema>;

export const watchlistRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  pair: z.string(),
  created_at: z.string(),
});

export type WatchlistRow = z.infer<typeof watchlistRowSchema>;

// ---------------------------------------------------------------------------
// Price alerts
// ---------------------------------------------------------------------------

export const ALERT_DIRECTIONS = ["above", "below"] as const;
export type AlertDirection = (typeof ALERT_DIRECTIONS)[number];

export const alertAddSchema = z.object({
  pair: z
    .string()
    .trim()
    .min(4)
    .transform((s) => normalizePair(s))
    .refine((p) => (PAIRS as readonly string[]).includes(p), {
      message: "Unsupported pair.",
    }),
  direction: z.enum(ALERT_DIRECTIONS),
  threshold: z
    .number()
    .positive("Threshold must be positive.")
    .max(1_000_000, "Threshold looks too large."),
});

export type AlertAdd = z.infer<typeof alertAddSchema>;

export const alertRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  pair: z.string(),
  direction: z.enum(ALERT_DIRECTIONS),
  threshold: z.number(),
  active: z.boolean(),
  triggered_at: z.string().nullable(),
  created_at: z.string(),
});

export type AlertRow = z.infer<typeof alertRowSchema>;

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

/**
 * Does the given rate trigger the alert?
 *
 *  - "above": triggers when rate >= threshold.
 *  - "below": triggers when rate <= threshold.
 *
 * Pure. Used by the UI to show which alerts are currently firing, and
 * by the server (future) to mark alerts as triggered.
 */
export function checkAlert(
  alert: { direction: AlertDirection; threshold: number },
  rate: number,
): boolean {
  if (!Number.isFinite(rate) || rate <= 0) return false;
  if (!Number.isFinite(alert.threshold) || alert.threshold <= 0) return false;
  return alert.direction === "above"
    ? rate >= alert.threshold
    : rate <= alert.threshold;
}

/**
 * Human-readable description of an alert.
 * "EURUSD above 1.1000"
 */
export function describeAlert(a: {
  pair: string;
  direction: AlertDirection;
  threshold: number;
}): string {
  return `${a.pair} ${a.direction} ${a.threshold}`;
}
