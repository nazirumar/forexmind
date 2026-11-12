"use client";

/**
 * News-aware risk banner (Feature 4).
 *
 * Fetches the economic calendar and warns when a high-impact event
 * (NFP, FOMC, CPI, rate decisions) is within the next ±2h of "now".
 * Shown on the plan-coach page so a trader about to plan a setup sees
 * the red-flag news before committing.
 *
 * Self-contained: fetches /api/calendar on mount, filters for
 * high-impact events near the current time, renders an amber banner.
 * Renders nothing when there's nothing to warn about (or when the
 * calendar fetch fails — non-fatal).
 */
import { useEffect, useState } from "react";
import { Newspaper } from "lucide-react";

type CalEvent = { time: string; title: string; impact: string };

export function NewsRiskBanner() {
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/calendar")
      .then((r) => (r.ok ? r.json() : null))
      .then((cal) => {
        if (!active || !cal?.events) return;
        const now = Date.now();
        const windowMs = 2 * 60 * 60_000; // ±2h
        const near = (cal.events as CalEvent[])
          .filter((e) => e.impact === "high")
          .filter((e) => {
            const t = Date.parse(e.time);
            return !Number.isNaN(t) && t >= now - windowMs && t <= now + windowMs;
          })
          .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
        if (near.length === 0) {
          setWarning(null);
          return;
        }
        const e = near[0]!;
        const minsAway = Math.round((Date.parse(e.time) - now) / 60000);
        const when =
          minsAway >= 0
            ? minsAway < 60
              ? `in ~${minsAway} min`
              : `in ~${Math.round(minsAway / 60)}h`
            : minsAway > -60
              ? `${Math.abs(minsAway)} min ago`
              : `${Math.round(Math.abs(minsAway) / 60)}h ago`;
        setWarning(
          `High-impact event "${e.title}" ${when}. Consider waiting until the dust settles before planning a new trade.`,
        );
      })
      .catch(() => {
        // Calendar unavailable - no banner.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!warning) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
    >
      <Newspaper className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{warning}</span>
    </div>
  );
}
