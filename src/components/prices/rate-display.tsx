"use client";

/**
 * Shared live-rate display pieces used by the dashboard ticker and
 * the watchlist page, so rates look identical everywhere:
 *
 *  - FLAGS: currency flag glyphs
 *  - readBaseline/writeBaseline: per-pair, per-day rate baseline in
 *    sessionStorage (the rates API has no history, so change badges
 *    show movement since the first load of the day)
 *  - RateDigits: rate with muted big figures + emphasized pips
 *  - PairLabel: flag + BASE/QUOTE with dimmed quote ccy
 *  - ChangeBadge: green/red % move with trend arrow (hidden when no
 *    baseline yet - we don't fabricate numbers)
 */
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRate, pctChange, type PriceQuote } from "@/lib/prices/schema";

export const FLAGS: Record<string, string> = {
  USD: "🇺🇸",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  CHF: "🇨🇭",
  AUD: "🇦🇺",
  CAD: "🇨🇦",
  NZD: "🇳🇿",
  XAU: "🥇",
};

/** Digits after the decimal point for a pair's rate display. */
export function pipDigits(pair: string): number {
  if (pair.endsWith("JPY")) return 3;
  if (pair === "XAUUSD") return 2;
  return 5;
}

/** sessionStorage baseline key: per calendar day + pair. */
function baselineKey(pair: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `fm_rate_baseline_${day}_${pair}`;
}

export function readBaseline(pair: string): number | null {
  try {
    const raw = sessionStorage.getItem(baselineKey(pair));
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeBaseline(pair: string, rate: number): void {
  try {
    sessionStorage.setItem(baselineKey(pair), String(rate));
  } catch {
    // Private mode etc. - change badges just stay hidden.
  }
}

/** Baseline every quote in a fresh response (first-seen rate per pair). */
export function baselineQuotes(quotes: { pair: string; rate: number }[]): void {
  for (const q of quotes) {
    if (readBaseline(q.pair) == null) writeBaseline(q.pair, q.rate);
  }
}

/** Split a formatted rate into muted big figures + emphasized pips. */
export function RateDigits({
  pair,
  rate,
  className,
}: {
  pair: string;
  rate: number;
  className?: string;
}) {
  const formatted = formatRate(pair, rate);
  const pips = pair.endsWith("JPY") ? 3 : 3;
  const split = Math.max(0, formatted.length - pips);
  const big = formatted.slice(0, split);
  const small = formatted.slice(split);
  return (
    <span className={cn("font-mono text-xs tabular-nums", className)}>
      <span className="text-muted-foreground">{big}</span>
      <span className="font-semibold text-foreground">{small}</span>
    </span>
  );
}

/** Flag glyph + BASE/QUOTE with the quote currency dimmed. */
export function PairLabel({ pair }: { pair: string }) {
  const base = pair.slice(0, 3);
  const quote = pair.slice(3);
  return (
    <>
      <span className="text-sm leading-none" aria-hidden="true">
        {FLAGS[base] ?? ""}
      </span>
      <span className="font-mono text-xs font-medium leading-none">
        {base}
        <span className="text-muted-foreground/60">/{quote}</span>
      </span>
    </>
  );
}

/** Green/red % move since the pair's baseline (hidden when unknown). */
export function ChangeBadge({ quote }: { quote: PriceQuote }) {
  const baseline = readBaseline(quote.pair);
  const change = pctChange(baseline, quote.rate);
  if (change == null) return null;
  const up = change > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[10px] font-medium tabular-nums",
        up ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500",
      )}
      title={`Since you first loaded today: ${baseline != null ? formatRate(quote.pair, baseline) : ""}`}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      {up ? "+" : ""}
      {change.toFixed(2)}%
    </span>
  );
}
