/**
 * Server-side price-alert sweep (the missing half of PriceAlert).
 *
 * Until now alerts were only evaluated client-side on the watchlist
 * page, and `triggered_at` was never written by the server. This
 * module evaluates every active, not-yet-triggered alert against the
 * cached FX rates and stamps `triggered_at` when an alert fires.
 *
 * It is a cross-user maintenance task (like the service-role concept):
 * it reads alerts for ALL users and must never expose another user's
 * data through a user-facing endpoint. It runs:
 *  - lazily from GET /api/prices (piggyback on ticker refreshes), and
 *  - on demand from /api/cron/alerts (guarded by CRON_SECRET) so an
 *    external scheduler can drive it when nobody is browsing.
 *
 * Delivery is currently in-app (triggered_at + UI badges). Email /
 * webhook delivery is a future phase (needs a provider + key).
 */
import { db } from "@/lib/db";
import { checkAlert, type AlertDirection } from "@/lib/watchlist/schema";
import { fetchLiveRates, getCachedRate } from "@/lib/prices/fetch";

export type TriggeredAlert = {
  id: string;
  userId: string;
  pair: string;
  direction: AlertDirection;
  threshold: number;
  /** The rate that fired the alert. */
  rate: number;
  triggeredAt: string;
};

/** Minimal alert shape the pure selector needs. */
export type PendingAlert = {
  id: string;
  userId: string;
  pair: string;
  direction: AlertDirection;
  threshold: number;
};

/**
 * Pure decision: which pending alerts fire given a pair -> rate map?
 * Alerts whose pair has no rate in the map are skipped (left pending).
 */
export function selectTriggered(
  alerts: PendingAlert[],
  rates: Record<string, number>,
): PendingAlert[] {
  return alerts.filter(
    (a) => rates[a.pair] != null && checkAlert(a, rates[a.pair]),
  );
}

/**
 * Evaluate all pending alerts against the current rate cache.
 *
 *  1. Ensure the rate cache is fresh (fetchLiveRates uses its own
 *     5-minute TTL; no extra upstream calls).
 *  2. Load every active alert that has never triggered (all users).
 *  3. Stamp triggered_at = now on the ones whose pair's current rate
 *     crosses the threshold. Each alert fires at most once — it stays
 *     visible (triggered) until the user deletes it.
 *
 * Errors are caught inside: a failing sweep must never break the
 * caller (the prices endpoint or cron route). Returns the alerts that
 * fired during this run.
 */
export async function evaluateAlerts(): Promise<TriggeredAlert[]> {
  try {
    // Refresh the cache if stale (no-op when fresh).
    await fetchLiveRates(false);

    const pending = (await db.priceAlert.findMany({
      where: { active: true, triggeredAt: null },
      select: { id: true, userId: true, pair: true, direction: true, threshold: true },
    })) as PendingAlert[];

    if (pending.length === 0) return [];

    const rates: Record<string, number> = {};
    for (const pair of new Set(pending.map((a) => a.pair))) {
      const rate = getCachedRate(pair);
      if (rate != null && Number.isFinite(rate)) rates[pair] = rate;
    }

    const triggered = selectTriggered(pending, rates);
    if (triggered.length === 0) return [];

    const now = new Date();
    // Fire at most once per alert: the update is scoped by id AND
    // triggeredAt = null so a concurrent sweep can't double-fire.
    await db.$transaction(
      triggered.map((a) =>
        db.priceAlert.updateMany({
          where: { id: a.id, triggeredAt: null },
          data: { triggeredAt: now },
        }),
      ),
    );

    return triggered.map((a) => ({
      id: a.id,
      userId: a.userId,
      pair: a.pair,
      direction: a.direction,
      threshold: a.threshold,
      rate: rates[a.pair],
      triggeredAt: now.toISOString(),
    }));
  } catch (err) {
    console.error("[alert-sweep] failed:", err);
    return [];
  }
}
