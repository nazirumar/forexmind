"use client";

/**
 * Trade Plan Coach - main interactive surface.
 *
 * Layout:
 *  - PageHeader with "Evaluate plan" button.
 *  - Two-column layout (lg+): left = plan idea form, right = verdict
 *    panel + AI observations (or empty-state CTA).
 *  - Recent plans list below the columns.
 *
 * State:
 *  - Plan form: local state, with pair/direction/entry/SL/TP/balance/
 *    risk%/lot/notes fields.
 *  - Result: response from POST /api/plan (auth required).
 *  - Recent plans: fetched from GET /api/plan, refreshed after each
 *    successful evaluation.
 *
 * Notes:
 *  - The endpoint requires auth. If the user is not signed in we
 *    surface a clear error.
 *  - Live R:R + pip distance recompute on every keystroke so the user
 *    sees the math before submitting.
 *  - We never call the AI without a complete, valid plan; the submit
 *    button is disabled until zod client-side says it's ok.
 */
import { useCallback, useEffect, useMemo, useState, FormEvent } from "react";
import {
  ClipboardList,
  Loader2,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  XCircle,
  Info,
  History,
  ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  planInputSchema,
  verdictMeta,
  severityMeta,
  type PlanResponse,
  type PlanListItem,
  type RuleResult,
  type PlanVerdict,
} from "@/lib/plan/schema";
import {
  normalizePair,
  pipSize,
  priceDiffInPips,
  riskRewardRatio,
} from "@/lib/risk";
import { cn } from "@/lib/utils";

const PAIRS = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD",
  "NZDUSD", "EURJPY", "GBPJPY", "EURGBP", "EURCHF", "AUDJPY",
  "GBPAUD", "AUDCAD", "NZDJPY", "XAUUSD",
] as const;

type PlanForm = {
  pair: string;
  direction: "buy" | "sell";
  entry_price: string;
  stop_loss: string;
  take_profit: string;
  account_balance: string;
  risk_pct: string;
  lot_size: string;
  notes: string;
};

const DEFAULT_FORM: PlanForm = {
  pair: "EURUSD",
  direction: "buy",
  entry_price: "1.0850",
  stop_loss: "1.0820",
  take_profit: "1.0910",
  account_balance: "",
  risk_pct: "",
  lot_size: "",
  notes: "",
};

const COLOR_CLASSES: Record<
  "emerald" | "amber" | "rose" | "slate",
  { text: string; bg: string; border: string; chip: string }
> = {
  emerald: {
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    chip: "bg-emerald-600 text-white",
  },
  amber: {
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    chip: "bg-amber-500 text-black",
  },
  rose: {
    text: "text-rose-500",
    bg: "bg-rose-500/10",
    border: "border-rose-500/40",
    chip: "bg-rose-600 text-white",
  },
  slate: {
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
    chip: "bg-muted text-foreground",
  },
};

export function PlanCoachClient() {
  const [form, setForm] = useState<PlanForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<PlanResponse | null>(null);
  const [recent, setRecent] = useState<PlanListItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  // -----------------------------------------------------------------
  // Client-side live math (RR + pip distances)
  // -----------------------------------------------------------------
  const liveMath = useMemo(() => {
    const entry = parseFloat(form.entry_price);
    const sl = parseFloat(form.stop_loss);
    const tp = parseFloat(form.take_profit);
    const pair = normalizePair(form.pair);
    if (!isFinite(entry) || !isFinite(sl) || entry <= 0 || sl <= 0) {
      return null;
    }
    const slPips = Math.abs(priceDiffInPips(pair, entry, sl));
    const tpPips =
      isFinite(tp) && tp > 0
        ? Math.abs(priceDiffInPips(pair, entry, tp))
        : null;
    const rr = tpPips != null ? riskRewardRatio(slPips, tpPips) : null;
    return { slPips, tpPips, rr };
  }, [form.entry_price, form.stop_loss, form.take_profit, form.pair]);

  // -----------------------------------------------------------------
  // Client-side validation (mirror of server zod)
  // -----------------------------------------------------------------
  const validation = useMemo(() => {
    const parsed = planInputSchema.safeParse({
      pair: form.pair,
      direction: form.direction,
      entry_price: parseFloat(form.entry_price),
      stop_loss: parseFloat(form.stop_loss),
      take_profit: form.take_profit ? parseFloat(form.take_profit) : null,
      account_balance: form.account_balance ? parseFloat(form.account_balance) : null,
      risk_pct: form.risk_pct ? parseFloat(form.risk_pct) : null,
      lot_size: form.lot_size ? parseFloat(form.lot_size) : null,
      notes: form.notes,
    });
    return parsed;
  }, [form]);

  // -----------------------------------------------------------------
  // Fetch recent plans
  // -----------------------------------------------------------------
  const refreshRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = await fetch("/api/plan?limit=10");
      if (res.ok) {
        const data = await res.json();
        setRecent(data.plans ?? []);
      }
    } catch {
      // ignore — list is decorative
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  // -----------------------------------------------------------------
  // Submit handler
  // -----------------------------------------------------------------
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validation.success) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.data),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setResponse(data as PlanResponse);
      refreshRecent();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Network error. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // -----------------------------------------------------------------
  // Update plan status (mark as taken / skipped)
  // -----------------------------------------------------------------
  async function updateStatus(id: string, status: PlanListItem["status"]) {
    try {
      const res = await fetch(`/api/plan/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) refreshRecent();
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade Plan Coach"
        description="Run a pre-trade plan against your own risk rules. The verdict is rule-compliance, not a trade recommendation."
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          <Button
            type="submit"
            form="plan-form"
            disabled={!validation.success || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Evaluating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Evaluate plan
              </>
            )}
          </Button>
        }
      />

      <Disclaimer />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: form */}
        <Card>
          <CardHeader>
            <CardTitle>Plan details</CardTitle>
          </CardHeader>
          <CardContent>
            <form id="plan-form" onSubmit={onSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pair">Pair</Label>
                  <Select
                    value={form.pair}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, pair: v }))
                    }
                  >
                    <SelectTrigger id="pair">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAIRS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Direction</Label>
                  <ToggleGroup
                    type="single"
                    value={form.direction}
                    onValueChange={(v) =>
                      v &&
                      setForm((f) => ({
                        ...f,
                        direction: v as "buy" | "sell",
                      }))
                    }
                    className="justify-start"
                  >
                    <ToggleGroupItem value="buy" aria-label="Buy">
                      Buy
                    </ToggleGroupItem>
                    <ToggleGroupItem value="sell" aria-label="Sell">
                      Sell
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="entry_price">Entry price</Label>
                  <Input
                    id="entry_price"
                    inputMode="decimal"
                    value={form.entry_price}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, entry_price: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stop_loss">Stop loss</Label>
                  <Input
                    id="stop_loss"
                    inputMode="decimal"
                    value={form.stop_loss}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, stop_loss: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="take_profit">
                  Take profit{" "}
                  <span className="text-xs text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="take_profit"
                  inputMode="decimal"
                  value={form.take_profit}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, take_profit: e.target.value }))
                  }
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="account_balance">
                    Balance{" "}
                    <span className="text-xs text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="account_balance"
                    inputMode="decimal"
                    placeholder="10000"
                    value={form.account_balance}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        account_balance: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="risk_pct">
                    Risk %{" "}
                    <span className="text-xs text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="risk_pct"
                    inputMode="decimal"
                    placeholder="1"
                    value={form.risk_pct}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, risk_pct: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lot_size">
                    Lot size{" "}
                    <span className="text-xs text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="lot_size"
                    inputMode="decimal"
                    placeholder="0.25"
                    value={form.lot_size}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, lot_size: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">
                  Notes{" "}
                  <span className="text-xs text-muted-foreground">
                    (optional - used as DATA only)
                  </span>
                </Label>
                <Textarea
                  id="notes"
                  rows={3}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="e.g. London open breakout, waiting for confirmation candle"
                />
              </div>

              {/* live math */}
              {liveMath ? (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      <span className="text-muted-foreground">SL:</span>{" "}
                      <span className="font-mono">
                        {liveMath.slPips.toFixed(1)} pips
                      </span>
                    </span>
                    {liveMath.tpPips != null && (
                      <span>
                        <span className="text-muted-foreground">TP:</span>{" "}
                        <span className="font-mono">
                          {liveMath.tpPips.toFixed(1)} pips
                        </span>
                      </span>
                    )}
                    {liveMath.rr != null && isFinite(liveMath.rr) && (
                      <span>
                        <span className="text-muted-foreground">R:R:</span>{" "}
                        <span className="font-mono">
                          {liveMath.rr.toFixed(2)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              ) : null}

              {/* validation error */}
              {!validation.success && (
                <div className="text-xs text-amber-500">
                  {validation.error.issues[0]?.message}
                </div>
              )}

              {/* submit error */}
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Right: result */}
        <div className="space-y-6">
          {response ? (
            <PlanResultPanel response={response} />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>

      {/* Recent plans */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Recent plans
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentLoading && recent.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No plans yet. Evaluate your first plan above.
            </p>
          ) : (
            <ul className="divide-y">
              {recent.map((p) => (
                <PlanRow key={p.id} item={p} onStatus={updateStatus} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Disclaimer() {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
      <strong>Disclaimer:</strong> ForexMind is advisory only. The plan
      coach evaluates your setup against your own risk rules — it does not
      predict prices or recommend trades. The decision is always yours.
      Trading forex involves substantial risk of loss.
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="flex min-h-[280px] items-center justify-center border-dashed">
      <CardContent className="py-12 text-center">
        <ClipboardList className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Fill in the plan form on the left and click{" "}
          <span className="font-medium">Evaluate plan</span> to see the
          deterministic rule check + AI observations.
        </p>
      </CardContent>
    </Card>
  );
}

function PlanResultPanel({ response }: { response: PlanResponse }) {
  const meta = verdictMeta(response.verdict);
  const colors = COLOR_CLASSES[meta.color];

  return (
    <Card className={cn("border", colors.border)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {response.verdict === "pass" ? (
              <CheckCircle2 className={cn("h-5 w-5", colors.text)} />
            ) : response.verdict === "review" ? (
              <AlertTriangle className={cn("h-5 w-5", colors.text)} />
            ) : (
              <XCircle className={cn("h-5 w-5", colors.text)} />
            )}
            <span>{meta.label}</span>
          </CardTitle>
          <Badge className={colors.chip}>{response.verdict.toUpperCase()}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{meta.blurb}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rule results */}
        <div className="space-y-2">
          {response.rule_results.map((r, i) => (
            <RuleRow key={i} rule={r} />
          ))}
        </div>

        {/* AI observations */}
        {response.ai_observations != null &&
          response.ai_observations.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                AI observations
                {!response.ai_called && (
                  <span className="text-xs text-muted-foreground">
                    (AI not called)
                  </span>
                )}
              </div>
              <ul className="space-y-1.5 text-sm">
                {response.ai_observations.map((o, i) => (
                  <li key={i} className="flex gap-2">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

        {/* Effective values */}
        <div className="rounded-md border bg-muted/20 p-3 text-xs">
          <div className="mb-1 font-medium">Effective values used</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
            <span>
              <span className="text-muted-foreground">Pair:</span>{" "}
              {response.plan.pair}
            </span>
            <span>
              <span className="text-muted-foreground">Direction:</span>{" "}
              {response.plan.direction}
            </span>
            <span>
              <span className="text-muted-foreground">Balance:</span> $
              {response.plan.account_balance.toLocaleString()}
            </span>
            <span>
              <span className="text-muted-foreground">Risk %:</span>{" "}
              {response.plan.risk_pct.toFixed(2)}%
            </span>
            {response.plan.lot_size != null && (
              <span>
                <span className="text-muted-foreground">Lot size:</span>{" "}
                {response.plan.lot_size}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleRow({ rule }: { rule: RuleResult }) {
  const colors = COLOR_CLASSES[rule.passed ? "emerald" : severityMeta(rule.severity).color];
  return (
    <div className="flex items-start gap-2 text-sm">
      {rule.passed ? (
        <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", colors.text)} />
      ) : rule.severity === "high" ? (
        <XCircle className={cn("mt-0.5 h-4 w-4 shrink-0", colors.text)} />
      ) : rule.severity === "medium" ? (
        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", colors.text)} />
      ) : (
        <Info className={cn("mt-0.5 h-4 w-4 shrink-0", colors.text)} />
      )}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{rule.rule}</span>
          <Badge variant="outline" className={cn("text-xs", colors.text)}>
            {rule.passed ? "PASS" : severityMeta(rule.severity).label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{rule.detail}</p>
      </div>
    </div>
  );
}

function PlanRow({
  item,
  onStatus,
}: {
  item: PlanListItem;
  onStatus: (id: string, status: PlanListItem["status"]) => void;
}) {
  const meta = verdictMeta(item.verdict as PlanVerdict);
  const colors = COLOR_CLASSES[meta.color];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <Badge className={colors.chip}>{item.verdict.toUpperCase()}</Badge>
      <span className="font-medium">{item.pair}</span>
      <span className="text-xs uppercase text-muted-foreground">
        {item.direction}
      </span>
      <span className="font-mono text-sm">@ {item.entry_price}</span>
      <span className="font-mono text-xs text-muted-foreground">
        SL {item.stop_loss}
        {item.take_profit != null && ` / TP ${item.take_profit}`}
      </span>
      {item.failed_rules > 0 && (
        <Badge variant="outline" className="text-xs text-rose-500">
          {item.failed_rules} rule{item.failed_rules === 1 ? "" : "s"} failed
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">
        {new Date(item.created_at).toLocaleString()}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {item.status === "planned" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatus(item.id, "taken")}
            >
              Mark taken
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onStatus(item.id, "skipped")}
            >
              Skip
            </Button>
          </>
        ) : (
          <Badge variant="outline" className="text-xs">
            {item.status}
          </Badge>
        )}
      </div>
    </li>
  );
}
