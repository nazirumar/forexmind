"use client";

/**
 * Trade Checker - main interactive surface.
 *
 * Layout:
 *  - PageHeader with "Run check" button.
 *  - Two-column layout (lg+): left = rules editor + trade idea form,
 *    right = verdict panel (or empty-state CTA).
 *
 * State:
 *  - Rules: stored in localStorage (no auth needed to edit them;
 *    they're the user's own words). Survive across sessions on the
 *    same device.
 *  - Trade idea: local state, default to a sensible EURUSD example.
 *  - Verdict: result of POST /api/checker (auth required).
 *
 * Notes:
 *  - The check endpoint requires auth. If the user is not signed in
 *    (sandbox without Supabase configured), we surface a clear error.
 *  - Live RR + pip distance recompute on every keystroke so the user
 *    sees the math before submitting.
 *  - We never call the AI without a complete, valid trade idea; the
 *    submit button is disabled until zod client-side says it's ok.
 */
import { useEffect, useMemo, useState, FormEvent } from "react";
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Sparkles,
  Save,
  BookOpen,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VerdictPanel } from "@/components/checker/verdict-panel";
import { CheckerHistoryPanel } from "@/components/checker/checker-history-panel";
import {
  tradeIdeaSchema,
  type CheckRequest,
  type CheckResponse,
} from "@/lib/checker/schema";
import {
  normalizePair,
  pipSize,
  priceDiffInPips,
  riskRewardRatio,
} from "@/lib/risk";
import { cn } from "@/lib/utils";

const RULES_LS_KEY = "forexmind:checker:rules";

const DEFAULT_RULES = `# My trading rules

## Risk
- Risk per trade: max 2% of account balance
- Daily loss limit: 6% (stop trading after)
- Weekly loss limit: 12% (review week)

## Setup
- Trade only London + New York overlap (12:00-16:00 UTC)
- Risk-reward minimum: 1.5
- Stop loss must be a real structure level, not a guess

## Behavior
- No trading during high-impact news (15 min before/after)
- No revenge trades after 2 consecutive losses
- Log every trade in the journal`;

const PAIRS = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD",
  "NZDUSD", "EURJPY", "GBPJPY", "EURGBP", "EURCHF", "AUDJPY",
  "GBPAUD", "AUDCAD", "NZDJPY", "XAUUSD",
] as const;

type IdeaForm = {
  pair: string;
  direction: "buy" | "sell";
  entry_price: string;
  stop_loss: string;
  take_profit: string;
  account_balance: string;
  risk_pct: string;
  lot_size: string;
  rationale: string;
};

const DEFAULT_FORM: IdeaForm = {
  pair: "EURUSD",
  direction: "buy",
  entry_price: "1.0850",
  stop_loss: "1.0820",
  take_profit: "1.0910",
  account_balance: "10000",
  risk_pct: "1",
  lot_size: "",
  rationale: "",
};

export function CheckerClient() {
  const [rules, setRules] = useState<string>("");
  const [rulesSaved, setRulesSaved] = useState(false);
  const [form, setForm] = useState<IdeaForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<CheckResponse | null>(null);
  // Bumped after each successful check so the history panel re-fetches.
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Load rules from localStorage on mount; fall back to defaults.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RULES_LS_KEY);
      if (stored !== null) setRules(stored);
      else setRules(DEFAULT_RULES);
    } catch {
      // localStorage disabled (private mode) - use defaults.
      setRules(DEFAULT_RULES);
    }
  }, []);

  // Auto-save rules with a small debounce so the user doesn't lose
  // their typing on a refresh.
  useEffect(() => {
    if (rules === "" ) return; // don't save before initial load
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(RULES_LS_KEY, rules);
        setRulesSaved(true);
        setTimeout(() => setRulesSaved(false), 1500);
      } catch {
        // localStorage disabled; ignore.
      }
    }, 600);
    return () => clearTimeout(id);
  }, [rules]);

  // Compute live risk metrics for the form preview.
  const preview = useMemo(() => computePreview(form), [form]);

  // Validate the idea client-side so the submit button knows when
  // to enable. We strip the optional fields the user left blank.
  const ideaValid = useMemo(() => {
    const payload = buildIdeaPayload(form);
    if (!payload) return false;
    return tradeIdeaSchema.safeParse(payload).success;
  }, [form]);

  const set = <K extends keyof IdeaForm>(k: K, v: IdeaForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResponse(null);

    const idea = buildIdeaPayload(form);
    if (!idea) {
      setError("Please fill in pair, direction, entry and stop loss.");
      return;
    }

    // Validate against the schema first; the parsed result has the
    // canonical shape (rationale defaulted to "", optionals normalized).
    const parseResult = tradeIdeaSchema.safeParse(idea);
    if (!parseResult.success) {
      const msg = parseResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      setError(`Invalid idea: ${msg}`);
      return;
    }

    const req: CheckRequest = { idea: parseResult.data, rules };

    setSubmitting(true);
    try {
      const res = await fetch("/api/checker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Sign in to run a check.");
        } else {
          setError(body?.error ?? `Failed (HTTP ${res.status})`);
        }
        return;
      }
      const data: CheckResponse = await res.json();
      setResponse(data);
      // Bump the history refresh key so the panel re-fetches and
      // shows the new check at the top of the list.
      setHistoryRefreshKey((k) => k + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error - please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Trade Checker"
        description="Submit a trade idea and let the AI act as a strict risk manager: it checks your idea against your own rules and your recent journal trades. Advisory only - the decision is always yours."
        icon={<ShieldCheck className="h-5 w-5" />}
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ---------- Left column: rules + idea form ---------- */}
        <div className="space-y-6">
          {/* Rules editor */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  My trading rules
                </CardTitle>
                {rulesSaved && (
                  <span className="text-[11px] text-emerald-500 flex items-center gap-1">
                    <Save className="h-3 w-3" aria-hidden="true" />
                    saved
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Stored in your browser (localStorage). The AI treats the text below as
                <strong> data</strong>, not instructions.
              </p>
            </CardHeader>
            <CardContent>
              <Textarea
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                rows={12}
                placeholder="Write your trading rules here. Risk limits, allowed sessions, setup criteria, behavior rules..."
                className="font-mono text-xs"
                aria-label="Your trading rules"
              />
              <div className="flex justify-between mt-2 text-[11px] text-muted-foreground">
                <span>{rules.length} chars</span>
                <button
                  type="button"
                  className="hover:text-foreground underline underline-offset-2"
                  onClick={() => setRules(DEFAULT_RULES)}
                >
                  Reset to defaults
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Trade idea form */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Trade idea</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Fill in the basic shape of the setup you&apos;re considering.
                Optional fields can be left blank.
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} noValidate className="space-y-4">
                {/* Pair + direction */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pair">Pair</Label>
                    <Select value={form.pair} onValueChange={(v) => set("pair", v)}>
                      <SelectTrigger id="pair">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAIRS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p.slice(0, 3)}/{p.slice(3)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Direction</Label>
                    <ToggleGroup
                      type="single"
                      value={form.direction}
                      onValueChange={(v) => {
                        if (v === "buy" || v === "sell") set("direction", v);
                      }}
                      className="w-full"
                    >
                      <ToggleGroupItem
                        value="buy"
                        className="flex-1 data-[state=on]:bg-emerald-600 data-[state=on]:text-white"
                      >
                        Buy
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="sell"
                        className="flex-1 data-[state=on]:bg-rose-600 data-[state=on]:text-white"
                      >
                        Sell
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </div>

                {/* Entry / SL / TP */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="entry">Entry</Label>
                    <Input
                      id="entry"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="1.0850"
                      value={form.entry_price}
                      onChange={(e) => set("entry_price", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sl">Stop loss</Label>
                    <Input
                      id="sl"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="1.0820"
                      value={form.stop_loss}
                      onChange={(e) => set("stop_loss", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tp">Take profit</Label>
                    <Input
                      id="tp"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="1.0910"
                      value={form.take_profit}
                      onChange={(e) => set("take_profit", e.target.value)}
                    />
                  </div>
                </div>

                {/* Optional: balance / risk% / lots */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="balance">Balance ($)</Label>
                    <Input
                      id="balance"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="10000"
                      value={form.account_balance}
                      onChange={(e) => set("account_balance", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="risk">Risk %</Label>
                    <Input
                      id="risk"
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      placeholder="1"
                      value={form.risk_pct}
                      onChange={(e) => set("risk_pct", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lots">Lots (optional)</Label>
                    <Input
                      id="lots"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="0.50"
                      value={form.lot_size}
                      onChange={(e) => set("lot_size", e.target.value)}
                    />
                  </div>
                </div>

                {/* Rationale */}
                <div className="space-y-1.5">
                  <Label htmlFor="rationale">Why this trade? (optional)</Label>
                  <Textarea
                    id="rationale"
                    rows={3}
                    placeholder="Briefly: what's your thesis? What levels are you watching?"
                    value={form.rationale}
                    onChange={(e) => set("rationale", e.target.value)}
                  />
                </div>

                {/* Live preview */}
                {preview && (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                      <span>
                        SL distance:{" "}
                        <span className="font-mono">{preview.slPips.toFixed(1)} pips</span>
                      </span>
                      {preview.tpPips != null && (
                        <span>
                          TP distance:{" "}
                          <span className="font-mono">{preview.tpPips.toFixed(1)} pips</span>
                        </span>
                      )}
                      <span>
                        RR:{" "}
                        <span
                          className={cn(
                            "font-mono",
                            preview.rr > 0 && preview.rr < 1
                              ? "text-amber-500"
                              : preview.rr >= 2
                                ? "text-emerald-500"
                                : "",
                          )}
                        >
                          {Number.isFinite(preview.rr) ? preview.rr.toFixed(2) : "—"}
                        </span>
                      </span>
                    </div>
                  </div>
                )}

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting || !ideaValid}
                  className="w-full"
                  aria-label="Run trade check"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Checking against your rules...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      Run check
                    </>
                  )}
                </Button>
                {!ideaValid && (
                  <p className="text-[11px] text-center text-muted-foreground">
                    Pair, direction, entry and stop loss are required. SL must be on
                    the correct side of entry for the direction.
                  </p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>

        {/* ---------- Right column: verdict panel ---------- */}
        <div className="space-y-4">
          {submitting && (
            <Card className="border-primary/30 bg-card/60">
              <CardContent className="py-8">
                <div className="space-y-3 animate-pulse" aria-label="Verdict loading">
                  <div className="h-5 w-1/2 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted/70" />
                  <div className="h-3 w-5/6 rounded bg-muted/70" />
                  <div className="mt-4 h-3 w-1/3 rounded bg-muted/50" />
                  <div className="h-3 w-full rounded bg-muted/50" />
                  <div className="h-3 w-3/4 rounded bg-muted/50" />
                </div>
              </CardContent>
            </Card>
          )}

          {!submitting && response && (
            <VerdictPanel
              verdict={response.verdict}
              hasJournalContext={response.has_journal_context}
              analysisId={response.analysis_id}
            />
          )}

          {!submitting && !response && !error && (
            <Card className="border-dashed bg-card/50">
              <CardContent className="py-12 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <ShieldCheck className="h-6 w-6" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-base font-medium">Ready to check</h2>
                <p className="mt-2 max-w-sm mx-auto text-sm text-muted-foreground">
                  Fill in the trade idea on the left, then click <strong>Run check</strong>.
                  The AI will compare your idea against your own rules and your recent
                  journal trades, then return a structured verdict.
                </p>
                <p className="mt-4 text-[11px] text-muted-foreground">
                  Advisory only. Never a buy or sell recommendation.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Recent checks history panel - below the verdict / empty state.
              Renders nothing when the user has no past checks (the panel's
              own empty state returns null in that case). */}
          <CheckerHistoryPanel refreshKey={historyRefreshKey} />

          {/* Disclaimer */}
          <p className="text-[11px] leading-relaxed text-muted-foreground px-1">
            Not financial advice. Trading forex involves substantial risk of loss.
            ForexMind never places trades and never predicts prices. The verdict is a
            rule-compliance check, not a trade recommendation.
          </p>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

type Preview = {
  slPips: number;
  tpPips: number | null;
  rr: number;
};

function computePreview(form: IdeaForm): Preview | null {
  const entry = Number(form.entry_price);
  const sl = Number(form.stop_loss);
  const tp = form.take_profit ? Number(form.take_profit) : NaN;
  if (!isFinite(entry) || !isFinite(sl) || entry <= 0 || sl <= 0) return null;
  const ps = pipSize(form.pair);
  const slPips = priceDiffInPips(form.pair, entry, sl);
  const tpPips = isFinite(tp) && tp > 0 ? priceDiffInPips(form.pair, entry, tp) : null;
  // For RR we need directional distance: rewardPips / riskPips.
  // Compute the directional distance so BUY with TP above entry gives
  // positive RR, SELL with TP below entry also gives positive RR.
  const signedSl =
    form.direction === "buy" ? (sl - entry) / ps : (entry - sl) / ps;
  // SL directional distance is negative (it's a loss); we want the
  // magnitude for risk.
  const riskPips = Math.abs(signedSl);
  const rewardPips =
    isFinite(tp) && tp > 0
      ? form.direction === "buy"
        ? (tp - entry) / ps
        : (entry - tp) / ps
      : NaN;
  const rr = isFinite(rewardPips)
    ? riskRewardRatio(riskPips, rewardPips)
    : NaN;
  return {
    slPips,
    tpPips,
    rr: Number.isFinite(rr) ? rr : NaN,
  };
}

/**
 * Build a payload for tradeIdeaSchema from the form, stripping the
 * optional fields the user left blank. Returns null if required
 * fields are missing.
 */
function buildIdeaPayload(form: IdeaForm): {
  pair: string;
  direction: "buy" | "sell";
  entry_price: number;
  stop_loss: number;
  take_profit?: number;
  account_balance?: number;
  risk_pct?: number;
  lot_size?: number;
  rationale?: string;
} | null {
  const entry = Number(form.entry_price);
  const sl = Number(form.stop_loss);
  if (!isFinite(entry) || !isFinite(sl)) return null;
  const payload: Record<string, unknown> = {
    pair: form.pair,
    direction: form.direction,
    entry_price: entry,
    stop_loss: sl,
  };
  if (form.take_profit) {
    const tp = Number(form.take_profit);
    if (isFinite(tp) && tp > 0) payload.take_profit = tp;
  }
  if (form.account_balance) {
    const b = Number(form.account_balance);
    if (isFinite(b) && b > 0) payload.account_balance = b;
  }
  if (form.risk_pct) {
    const r = Number(form.risk_pct);
    if (isFinite(r) && r >= 0) payload.risk_pct = r;
  }
  if (form.lot_size) {
    const l = Number(form.lot_size);
    if (isFinite(l) && l > 0) payload.lot_size = l;
  }
  if (form.rationale.trim()) payload.rationale = form.rationale.trim();
  return payload as { pair: string; direction: "buy" | "sell"; entry_price: number; stop_loss: number };
}
