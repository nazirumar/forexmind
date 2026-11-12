"use client";

/**
 * Trading Goals - main interactive surface.
 *
 * Two panels:
 *  1. Goals form: set/edit the user's discipline rules (max trades/day,
 *     max daily loss %, min RR, max consecutive losses, require plan).
 *     Saved via PUT /api/goals.
 *  2. Discipline report: fetches the user's recent trades from
 *     /api/trades and runs the pure evaluateGoals() engine against
 *     the saved goals, listing any violations.
 *
 * The report is DETERMINISTIC - no AI. We surface what the rules say
 * and let the user decide what to change.
 */
import { useCallback, useEffect, useMemo, useState, FormEvent } from "react";
import { Target, Loader2, AlertTriangle, Save, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  evaluateGoals,
  violationSummary,
  type GoalViolation,
} from "@/lib/goals/rules";
import { DEFAULT_GOALS, type GoalsRow } from "@/lib/goals/schema";
import type { TradeListResponse } from "@/lib/trades/schema";
import { cn } from "@/lib/utils";

type FormState = {
  max_trades_per_day: string;
  max_daily_loss_pct: string;
  min_rr_target: string;
  max_consecutive_losses: string;
  require_followed_plan: boolean;
};

function goalsToForm(g: GoalsRow): FormState {
  return {
    max_trades_per_day: g.max_trades_per_day?.toString() ?? "",
    max_daily_loss_pct: g.max_daily_loss_pct?.toString() ?? "",
    min_rr_target: g.min_rr_target?.toString() ?? "",
    max_consecutive_losses: g.max_consecutive_losses?.toString() ?? "",
    require_followed_plan: g.require_followed_plan,
  };
}

export function GoalsClient() {
  const [loaded, setLoaded] = useState(false);
  const [goals, setGoals] = useState<GoalsRow>(DEFAULT_GOALS);
  const [form, setForm] = useState<FormState>(goalsToForm(DEFAULT_GOALS));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);

  // Report state
  const [trades, setTrades] = useState<TradeListResponse["trades"]>([]);
  const [reportLoaded, setReportLoaded] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadGoals = useCallback(async () => {
    setLoaded(false);
    try {
      const res = await fetch("/api/goals");
      if (res.status === 401) {
        setAuthRequired(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GoalsRow = await res.json();
      setGoals(data);
      setForm(goalsToForm(data));
    } catch {
      // ignore - keep defaults
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadTrades = useCallback(async () => {
    setReportLoaded(false);
    setReportError(null);
    try {
      const res = await fetch("/api/trades?limit=100");
      if (res.status === 401) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TradeListResponse = await res.json();
      setTrades(data.trades);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to load trades.");
    } finally {
      setReportLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadGoals();
    void loadTrades();
  }, [loadGoals, loadTrades]);

  const violations: GoalViolation[] = useMemo(
    () => evaluateGoals(trades, goals),
    [trades, goals],
  );
  const summary = useMemo(() => violationSummary(violations), [violations]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {};
      if (form.max_trades_per_day.trim() !== "")
        body.max_trades_per_day = Number(form.max_trades_per_day);
      else body.max_trades_per_day = null;
      if (form.max_daily_loss_pct.trim() !== "")
        body.max_daily_loss_pct = Number(form.max_daily_loss_pct);
      else body.max_daily_loss_pct = null;
      if (form.min_rr_target.trim() !== "")
        body.min_rr_target = Number(form.min_rr_target);
      else body.min_rr_target = null;
      if (form.max_consecutive_losses.trim() !== "")
        body.max_consecutive_losses = Number(form.max_consecutive_losses);
      else body.max_consecutive_losses = null;
      body.require_followed_plan = form.require_followed_plan;

      const res = await fetch("/api/goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `HTTP ${res.status}`);
      }
      const saved: GoalsRow = await res.json();
      setGoals(saved);
      setForm(goalsToForm(saved));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (authRequired) {
    return (
      <div className="space-y-6">
        <PageHeader title="Trading Goals" icon={<Target className="h-5 w-5" />} />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Sign in to set and track your trading goals.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trading Goals"
        description="Self-imposed discipline rules. Set the limits you want to hold yourself to; the report below checks your recent trades against them. The rules are deterministic - no AI judgement involved."
        icon={<Target className="h-5 w-5" />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Goals form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your rules</CardTitle>
            <p className="text-xs text-muted-foreground">
              Leave a field blank to disable that rule. NULL = not enforced.
            </p>
          </CardHeader>
          <CardContent>
            {!loaded ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="max_trades_per_day">Max trades per day</Label>
                  <Input
                    id="max_trades_per_day"
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    placeholder="e.g. 5"
                    value={form.max_trades_per_day}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, max_trades_per_day: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max_daily_loss_pct">Max daily loss %</Label>
                  <Input
                    id="max_daily_loss_pct"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="e.g. 3"
                    value={form.max_daily_loss_pct}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, max_daily_loss_pct: e.target.value }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Of account balance. A day counts as a violation only if the
                    summed PnL for that day is negative and exceeds this %.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="min_rr_target">Min risk-reward target</Label>
                  <Input
                    id="min_rr_target"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="e.g. 1.5"
                    value={form.min_rr_target}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, min_rr_target: e.target.value }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Trades without a take-profit are skipped (can&apos;t compute RR).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max_consecutive_losses">Max consecutive losses</Label>
                  <Input
                    id="max_consecutive_losses"
                    type="number"
                    min={1}
                    max={20}
                    step={1}
                    placeholder="e.g. 3"
                    value={form.max_consecutive_losses}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        max_consecutive_losses: e.target.value,
                      }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Flags any run of losses longer than this. A winner resets the counter.
                  </p>
                </div>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={form.require_followed_plan}
                    onCheckedChange={(v) =>
                      setForm((f) => ({ ...f, require_followed_plan: v === true }))
                    }
                  />
                  <span className="text-sm">
                    Require every trade to follow the plan
                  </span>
                </label>

                {saveError && (
                  <p className="text-xs text-destructive">{saveError}</p>
                )}
                {saved && (
                  <p className="flex items-center gap-1 text-xs text-emerald-500">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Saved.
                  </p>
                )}
                <Button type="submit" disabled={saving} className="w-full">
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save goals
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Discipline report */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Discipline report</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadTrades()}
                disabled={!reportLoaded}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Re-check
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Checks your last 100 trades against the saved rules. Violations are
              surfaced as honest feedback, not a judgement.
            </p>
          </CardHeader>
          <CardContent>
            {!reportLoaded ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : reportError ? (
              <p className="text-sm text-destructive">{reportError}</p>
            ) : violations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <p className="text-sm font-medium">No violations</p>
                <p className="text-xs text-muted-foreground">
                  Your recent trades are within all the rules you&apos;ve set.
                  Either you&apos;re disciplined, or you haven&apos;t set many rules yet.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-rose-600 text-white">
                    {summary.high} high
                  </Badge>
                  {summary.medium > 0 && (
                    <Badge className="bg-amber-500 text-black">
                      {summary.medium} medium
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground self-center">
                    across {trades.length} trades
                  </span>
                </div>
                <div className="max-h-[400px] space-y-2 overflow-y-auto">
                  {violations.map((v, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-md border p-2.5 text-xs",
                        v.severity === "high"
                          ? "border-rose-500/40 bg-rose-500/5"
                          : "border-amber-500/40 bg-amber-500/5",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {v.severity === "high" ? (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{v.message}</p>
                          <p className="text-muted-foreground">
                            {v.at.slice(0, 10)} - rule: {v.rule}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Advisory only. Goals are self-imposed guardrails, not a guarantee of
        profitability. The decision to keep or break a rule is always yours.
      </p>
    </div>
  );
}
