"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Calculator, AlertTriangle, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  normalizePair,
  pipSize,
  priceDiffInPips,
  pipValuePerLot,
  positionSize,
  riskRewardRatio,
  potentialLoss,
  potentialProfit,
  breakEvenWinRate,
  riskWarnings,
} from "@/lib/risk";

/**
 * 15 common forex pairs + XAUUSD (gold) as required by the spec.
 * The "needs price" flag is true when pipValuePerLot can't be
 * computed from the pair alone (JPY quote, USD base, or cross).
 */
const PAIRS: { value: string; label: string; needsPrice: boolean }[] = [
  { value: "EURUSD", label: "EUR/USD", needsPrice: false },
  { value: "GBPUSD", label: "GBP/USD", needsPrice: false },
  { value: "USDJPY", label: "USD/JPY", needsPrice: true },
  { value: "USDCHF", label: "USD/CHF", needsPrice: true },
  { value: "AUDUSD", label: "AUD/USD", needsPrice: false },
  { value: "USDCAD", label: "USD/CAD", needsPrice: true },
  { value: "NZDUSD", label: "NZD/USD", needsPrice: false },
  { value: "EURJPY", label: "EUR/JPY", needsPrice: true },
  { value: "GBPJPY", label: "GBP/JPY", needsPrice: true },
  { value: "EURGBP", label: "EUR/GBP", needsPrice: true },
  { value: "EURCHF", label: "EUR/CHF", needsPrice: true },
  { value: "AUDJPY", label: "AUD/JPY", needsPrice: true },
  { value: "GBPAUD", label: "GBP/AUD", needsPrice: true },
  { value: "AUDCAD", label: "AUD/CAD", needsPrice: true },
  { value: "NZDJPY", label: "NZD/JPY", needsPrice: true },
  { value: "XAUUSD", label: "XAU/USD (Gold)", needsPrice: false },
];

type FormState = {
  balance: string;
  riskPct: string;
  pair: string;
  direction: "buy" | "sell";
  entry: string;
  stopLoss: string;
  takeProfit: string;
  currentPrice: string;
};

const DEFAULT_FORM: FormState = {
  balance: "10000",
  riskPct: "1",
  pair: "EURUSD",
  direction: "buy",
  entry: "1.0850",
  stopLoss: "1.0820",
  takeProfit: "1.0910",
  currentPrice: "",
};

export function RiskCalculatorClient() {
  const searchParams = useSearchParams();
  const initialPair = searchParams.get("pair") ?? "EURUSD";

  const [form, setForm] = useState<FormState>(() => ({
    ...DEFAULT_FORM,
    pair: PAIRS.some((p) => p.value === initialPair) ? initialPair : "EURUSD",
  }));

  // Live prices: fetch on mount so we can auto-fill "current price"
  // for JPY / USD-base pairs that need it for pip-value computation.
  const [liveRates, setLiveRates] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    fetch("/api/prices")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data?.quotes) return;
        const map: Record<string, number> = {};
        for (const q of data.quotes) map[q.pair] = q.rate;
        setLiveRates(map);
      })
      .catch(() => {
        // Network error - live prices just won't auto-fill. The user
        // can still type the price manually.
      });
    return () => {
      active = false;
    };
  }, []);

  // Profile defaults: fetch on mount. If the user has a profile with
  // default_balance / default_risk_pct / default_pair set, AND the URL
  // didn't specify ?pair= (URL param wins), apply the profile defaults.
  // This only runs ONCE on mount - subsequent edits respect the user's
  // typing.
  useEffect(() => {
    let active = true;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (!active || !profile) return;
        setForm((prev) => {
          const next = { ...prev };
          // Only apply profile defaults if the URL didn't specify ?pair=
          if (!searchParams.get("pair") && profile.default_pair) {
            next.pair = profile.default_pair;
          }
          if (profile.default_balance != null && prev.balance === "10000") {
            next.balance = String(profile.default_balance);
          }
          if (profile.default_risk_pct != null && prev.riskPct === "1") {
            next.riskPct = String(profile.default_risk_pct);
          }
          return next;
        });
      })
      .catch(() => {
        // Profile fetch failed (not signed in, or endpoint error).
        // Silently fall back to hardcoded defaults - the calculator
        // still works without a profile.
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Auto-fill currentPrice when:
  //  - the pair needs a price (JPY quote, USD base, or cross), AND
  //  - we have a live rate for it, AND
  //  - the user hasn't typed anything into the field yet.
  // Once the user types, we stop auto-filling (respect their input).
  const pairNeedsPrice = PAIRS.find((p) => p.value === normalizePair(form.pair))?.needsPrice ?? false;
  const liveRate = liveRates[form.pair];
  useEffect(() => {
    if (pairNeedsPrice && liveRate != null && form.currentPrice === "") {
      setForm((prev) => ({ ...prev, currentPrice: String(liveRate) }));
    }
  }, [pairNeedsPrice, liveRate, form.currentPrice]);

  // Derived values recompute on every keystroke.
  const computed = useMemo(() => compute(form), [form]);
  const pairMeta = PAIRS.find((p) => p.value === normalizePair(form.pair));
  const showPriceField = pairMeta?.needsPrice ?? false;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      // When the pair changes, clear the currentPrice field so the
      // live-price auto-fill effect can re-trigger for the new pair.
      if (key === "pair" && value !== prev.pair) {
        return { ...prev, pair: value as FormState["pair"], currentPrice: "" };
      }
      return { ...prev, [key]: value };
    });
  };

  const reset = () => setForm(DEFAULT_FORM);

  return (
    <>
      <PageHeader
        title="Risk Calculator"
        description="Compute position size, pip value, risk-reward and break-even win rate. Pure math - no AI, no predictions."
        icon={<Calculator className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={reset}>
            Reset
          </Button>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* ---------- Form ---------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Trade inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Account balance + risk % */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="balance">Account balance ($)</Label>
                <Input
                  id="balance"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="100"
                  value={form.balance}
                  onChange={(e) => update("balance", e.target.value)}
                  aria-label="Account balance in USD"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="riskPct">Risk per trade (%)</Label>
                <Input
                  id="riskPct"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.1"
                  value={form.riskPct}
                  onChange={(e) => update("riskPct", e.target.value)}
                  aria-label="Risk percentage per trade"
                />
              </div>
            </div>

            {/* Pair */}
            <div className="space-y-1.5">
              <Label htmlFor="pair">Currency pair</Label>
              <Select
                value={form.pair}
                onValueChange={(v) => update("pair", v)}
              >
                <SelectTrigger id="pair" className="w-full" aria-label="Currency pair">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAIRS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Pip size: <span className="font-mono">{computed.pipSize}</span> per pip
              </p>
            </div>

            {/* Direction */}
            <div className="space-y-1.5">
              <Label>Direction</Label>
              <ToggleGroup
                type="single"
                value={form.direction}
                onValueChange={(v) => v && update("direction", v as "buy" | "sell")}
                className="grid grid-cols-2 gap-2"
              >
                <ToggleGroupItem
                  value="buy"
                  variant="outline"
                  className="data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-400 data-[state=on]:border-emerald-500/40"
                >
                  <ArrowUpRight className="h-4 w-4 mr-1" /> Buy
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="sell"
                  variant="outline"
                  className="data-[state=on]:bg-rose-500/15 data-[state=on]:text-rose-400 data-[state=on]:border-rose-500/40"
                >
                  <ArrowDownRight className="h-4 w-4 mr-1" /> Sell
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Entry / SL / TP */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="entry">Entry</Label>
                <Input
                  id="entry"
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  value={form.entry}
                  onChange={(e) => update("entry", e.target.value)}
                  aria-label="Entry price"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sl">Stop loss</Label>
                <Input
                  id="sl"
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  value={form.stopLoss}
                  onChange={(e) => update("stopLoss", e.target.value)}
                  aria-label="Stop loss price"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tp">Take profit</Label>
                <Input
                  id="tp"
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  value={form.takeProfit}
                  onChange={(e) => update("takeProfit", e.target.value)}
                  aria-label="Take profit price"
                />
              </div>
            </div>

            {/* Optional current price (for JPY/USD-base/cross pairs) */}
            {showPriceField && (
              <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <Label htmlFor="price">
                  Current price <span className="text-amber-400">(required for this pair)</span>
                </Label>
                <Input
                  id="price"
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  value={form.currentPrice}
                  onChange={(e) => update("currentPrice", e.target.value)}
                  aria-label="Current market price for pip value conversion"
                  placeholder="e.g. 150.00 for USDJPY"
                />
                <p className="text-[11px] text-muted-foreground">
                  For {form.pair}, pip value depends on the live rate. Enter the current
                  market price to compute it accurately.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------- Results + warnings ---------- */}
        <div className="lg:col-span-3 space-y-4">
          {/* Warnings */}
          {computed.warnings.length > 0 && (
            <div className="space-y-2">
              {computed.warnings.map((w, i) => (
                <div
                  key={i}
                  role={w.level === "error" ? "alert" : "status"}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                    w.level === "error"
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-200",
                  )}
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Headline result: lot size */}
          <Card className="border-primary/30">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Position size
                </p>
                <p className="mt-1 text-4xl sm:text-5xl font-semibold tabular-nums">
                  {computed.lots.isValid ? (
                    <>
                      {computed.lots.value.toFixed(2)}
                      <span className="ml-2 text-lg text-muted-foreground">lots</span>
                    </>
                  ) : (
                    <span className="text-2xl text-muted-foreground">—</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {computed.lots.isValid
                    ? `Risking $${computed.riskAmount.toFixed(2)} on ${computed.stopPips.toFixed(0)} pips`
                    : "Fill the form to compute your position size"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Grid of metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MetricCard
              label="Risk $"
              value={computed.riskAmount}
              format="money"
              tone="danger"
            />
            <MetricCard
              label="Reward $"
              value={computed.rewardAmount}
              format="money"
              tone="success"
            />
            <MetricCard
              label="Risk / Reward"
              value={computed.rr}
              format="ratio"
              tone={computed.rr > 0 && computed.rr >= 1 ? "success" : "warning"}
            />
            <MetricCard
              label="Pips to SL"
              value={computed.stopPips}
              format="pips"
            />
            <MetricCard
              label="Pips to TP"
              value={computed.takeProfitPips}
              format="pips"
            />
            <MetricCard
              label="Break-even win rate"
              value={computed.breakEven}
              format="percent"
            />
          </div>

          {/* Formula reference */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">How this is calculated</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1.5">
              <p>
                <span className="font-medium text-foreground">Pip size</span> = 0.0001 (default) · 0.01 (JPY pairs) · 0.1 (XAUUSD)
              </p>
              <p>
                <span className="font-medium text-foreground">Pip value/lot</span> =
                $10 for USD-quote pairs · 1000 ÷ price for JPY · 10 ÷ price for USD-base
              </p>
              <p>
                <span className="font-medium text-foreground">Lots</span> = (balance × risk% ÷ 100) ÷ (SL pips × pip value)
              </p>
              <p>
                <span className="font-medium text-foreground">Break-even win rate</span> = 1 ÷ (1 + RR)
              </p>
              <p className="pt-1 text-amber-200/80">
                Not financial advice. Trading forex involves substantial risk of loss.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Computed = {
  pipSize: string;
  lots: { value: number; isValid: boolean };
  riskAmount: number;
  rewardAmount: number;
  rr: number;
  stopPips: number;
  takeProfitPips: number;
  breakEven: number;
  warnings: { level: "error" | "warning"; message: string }[];
};

function compute(form: FormState): Computed {
  const pair = normalizePair(form.pair);
  const size = pipSize(pair);
  const balance = parseFloat(form.balance);
  const riskPct = parseFloat(form.riskPct);
  const entry = parseFloat(form.entry);
  const stopLoss = parseFloat(form.stopLoss);
  const takeProfit = parseFloat(form.takeProfit);
  const currentPrice = parseFloat(form.currentPrice);

  const empty: Computed = {
    pipSize: size.toString(),
    lots: { value: NaN, isValid: false },
    riskAmount: NaN,
    rewardAmount: NaN,
    rr: NaN,
    stopPips: NaN,
    takeProfitPips: NaN,
    breakEven: NaN,
    warnings: [],
  };

  const hasCore =
    isFinite(balance) && balance > 0 &&
    isFinite(riskPct) && riskPct > 0 &&
    isFinite(entry) &&
    isFinite(stopLoss);

  if (!hasCore) {
    return {
      ...empty,
      warnings: riskWarnings({
        pair, direction: form.direction, entry, stopLoss,
        riskPct,
      }),
    };
  }

  const stopPips = priceDiffInPips(pair, entry, stopLoss);
  const tp = parseFloat(form.takeProfit);
  const takeProfitPips = isFinite(tp) ? priceDiffInPips(pair, entry, tp) : NaN;

  const pv = pipValuePerLot(pair, isFinite(currentPrice) ? currentPrice : undefined);
  const hasPipValue = isFinite(pv) && pv > 0;

  const lots = hasPipValue ? positionSize(balance, riskPct, stopPips, pv) : NaN;
  const lotsValid = isFinite(lots) && lots > 0;

  const rr = isFinite(takeProfitPips) && takeProfitPips >= 0
    ? riskRewardRatio(stopPips, takeProfitPips)
    : NaN;

  const riskAmount = lotsValid
    ? potentialLoss(lots, stopPips, pv)
    : balance * (riskPct / 100); // fall back to nominal risk if lots unknown
  const rewardAmount = lotsValid && isFinite(takeProfitPips)
    ? potentialProfit(lots, takeProfitPips, pv)
    : NaN;
  const breakEven = isFinite(rr) ? breakEvenWinRate(rr) : NaN;

  const warnings = riskWarnings({
    pair,
    direction: form.direction,
    entry,
    stopLoss,
    takeProfit: isFinite(tp) ? tp : undefined,
    riskPct,
    rr,
    stopLossPips: stopPips,
    takeProfitPips,
  });

  return {
    pipSize: size.toString(),
    lots: { value: lots, isValid: lotsValid },
    riskAmount,
    rewardAmount,
    rr,
    stopPips,
    takeProfitPips,
    breakEven,
    warnings,
  };
}

function MetricCard({
  label,
  value,
  format,
  tone,
}: {
  label: string;
  value: number;
  format: "money" | "ratio" | "pips" | "percent";
  tone?: "danger" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-rose-400"
      : tone === "success"
        ? "text-emerald-400"
        : tone === "warning"
          ? "text-amber-400"
          : "text-foreground";

  const formatted = (() => {
    if (!isFinite(value)) return "—";
    switch (format) {
      case "money":
        return `$${value.toFixed(2)}`;
      case "ratio":
        return value.toFixed(2);
      case "pips":
        return `${value.toFixed(0)} pips`;
      case "percent":
        return `${(value * 100).toFixed(1)}%`;
    }
  })();

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={cn("mt-1 text-xl font-semibold tabular-nums", toneClass)}>
          {formatted}
        </p>
      </CardContent>
    </Card>
  );
}
