"use client";

/**
 * Trade form (create + edit).
 *
 * - Used inside a <Dialog>. Parent controls open/close and supplies
 *   the optional `initial` trade to edit.
 * - zod validation runs on submit; field-level errors render inline.
 * - Sends JSON to POST /api/trades or PATCH /api/trades/[id].
 * - Calls onSaved(trade) on success so the parent can update the
 *   list in-place without re-fetching.
 *
 * Conventions:
 *  - Datetime-local inputs produce "YYYY-MM-DDTHH:mm" without a
 *    timezone. We treat them as local and append the user's offset
 *    so the server stores a real ISO timestamp.
 *  - Numbers are kept as strings in form state until submit, so the
 *    user can type "1.08" without the field immediately snapping to
 *    "1.08".
 *  - "Exit price" auto-suggests PnL via pip math when entered; the
 *    user can still override the suggested value.
 */
import { useState, useEffect, FormEvent, KeyboardEvent } from "react";
import { Loader2, AlertTriangle, X, Hash, Camera, Calculator, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  PAIRS,
  SESSIONS,
  TIMEFRAMES,
  MISTAKE_TYPES,
  formatPair,
  normalizeTags,
  MAX_TAGS,
  type TradeRow,
} from "@/lib/trades/schema";
import {
  pipSize,
  priceDiffInPips,
  pipValuePerLot,
  positionSize,
} from "@/lib/risk";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = {
  /** Existing trade to edit, or null for create. */
  initial?: TradeRow | null;
  /** Called with the saved trade. Parent closes the dialog. */
  onSaved: (trade: TradeRow) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
};

type FormState = {
  pair: string;
  direction: "buy" | "sell";
  entry_price: string;
  exit_price: string;
  stop_loss: string;
  take_profit: string;
  lot_size: string;
  opened_at: string; // datetime-local format
  closed_at: string; // datetime-local format or ""
  pnl: string;
  strategy: string;
  session: string;
  emotion: string;
  followed_plan: boolean;
  notes: string;
  /** Slugified, deduped tags. Empty array when untagged. */
  tags: string[];
  // ---- Risk-management fields (Feature 1) ----
  account_balance: string;
  risk_pct: string;
  risk_amount: string;
  timeframe: string;
  // ---- Psychology (Feature 2) ----
  mistake_type: string;
  // ---- Screenshots (Feature 2): Storage URLs ----
  screenshot_url: string;
  screenshot_after_url: string;
};

type FieldErrors = Record<string, string>;

/** Convert an ISO timestamp to "YYYY-MM-DDTHH:mm" for <input type=datetime-local>. */
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // toISOString gives UTC; we want local time as the user typed it.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Convert a datetime-local value to a real ISO string with TZ. */
function localInputToIso(s: string): string {
  // The browser already includes offset info when constructing Date
  // from "YYYY-MM-DDTHH:mm"; new Date() honors the local timezone.
  const d = new Date(s);
  return d.toISOString();
}

/** Suggest a PnL for the form's current state. NaN if cannot compute. */
function suggestPnl(f: FormState): number {
  const entry = Number(f.entry_price);
  const exit = Number(f.exit_price);
  const lots = Number(f.lot_size);
  if (!isFinite(entry) || !isFinite(exit) || !isFinite(lots)) return NaN;
  if (entry <= 0 || exit <= 0 || lots <= 0) return NaN;

  const ps = pipSize(f.pair);
  const diffPips = (f.direction === "buy" ? exit - entry : entry - exit) / ps;
  const pipValue = pipValuePerLot(f.pair, entry);
  if (!isFinite(pipValue) || pipValue <= 0) return NaN;

  return diffPips * pipValue * lots;
}

export function TradeForm({ initial, onSaved, onCancel }: Props) {
  const isEdit = Boolean(initial);

  const [form, setForm] = useState<FormState>(() => ({
    pair: initial?.pair ?? "EURUSD",
    direction: initial?.direction ?? "buy",
    entry_price: initial ? String(initial.entry_price) : "",
    exit_price: initial && initial.exit_price != null ? String(initial.exit_price) : "",
    stop_loss: initial ? String(initial.stop_loss) : "",
    take_profit: initial && initial.take_profit != null ? String(initial.take_profit) : "",
    lot_size: initial ? String(initial.lot_size) : "",
    opened_at: isoToLocalInput(initial?.opened_at),
    closed_at: isoToLocalInput(initial?.closed_at),
    pnl: initial && initial.pnl != null ? String(initial.pnl) : "",
    strategy: initial?.strategy ?? "",
    session: initial?.session ?? "",
    emotion: initial?.emotion ?? "",
    followed_plan: initial?.followed_plan ?? true,
    notes: initial?.notes ?? "",
    tags: initial?.tags ?? [],
    // Risk-management fields (Feature 1).
    account_balance:
      initial?.account_balance != null ? String(initial.account_balance) : "",
    risk_pct: initial?.risk_pct != null ? String(initial.risk_pct) : "",
    risk_amount:
      initial?.risk_amount != null ? String(initial.risk_amount) : "",
    timeframe: initial?.timeframe ?? "",
    // Psychology + screenshots (Feature 2).
    mistake_type: initial?.mistake_type ?? "",
    screenshot_url: initial?.screenshot_url ?? "",
    screenshot_after_url: initial?.screenshot_after_url ?? "",
  }));

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auto-suggest PnL when relevant fields change AND the user hasn't
  // typed one in manually yet (we track "userTypedPnl" to detect that).
  const [userTypedPnl, setUserTypedPnl] = useState(
    initial?.pnl != null || false,
  );
  useEffect(() => {
    if (userTypedPnl) return;
    const suggested = suggestPnl(form);
    setForm((f) => ({
      ...f,
      pnl: isFinite(suggested) ? suggested.toFixed(2) : "",
    }));
  }, [
    form.pair,
    form.direction,
    form.entry_price,
    form.exit_price,
    form.lot_size,
    userTypedPnl,
  ]);

  // Profile defaults: fetch on mount. Applies preferred_session and
  // default_pair to the form ONLY when creating a new trade (not
  // editing) and only when the user hasn't touched those fields yet.
  // Non-fatal: if the fetch fails, the form stays as-is.
  useEffect(() => {
    if (isEdit) return; // editing an existing trade - don't override
    let active = true;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (!active || !profile) return;
        setForm((f) => ({
          ...f,
          // Only override fields the user hasn't touched (still empty
          // or at their initial values).
          session: f.session === "" && profile.preferred_session
            ? profile.preferred_session
            : f.session,
          pair: f.pair === "EURUSD" && profile.default_pair
            ? profile.default_pair
            : f.pair,
        }));
      })
      .catch(() => {
        // Profile fetch failed - form stays with built-in defaults.
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ---- News-aware risk overlay (Feature 4) ----
  // Fetch the economic calendar once on mount, then warn whenever the
  // trade's opened_at falls within ±2h of a high-impact event (NFP,
  // FOMC, CPI, etc.). Red-flag news is the #1 reason disciplined
  // traders skip a setup.
  const [newsWarning, setNewsWarning] = useState<string | null>(null);
  const [highImpactEvents, setHighImpactEvents] = useState<
    { time: string; title: string }[]
  >([]);

  useEffect(() => {
    let active = true;
    fetch("/api/calendar")
      .then((r) => (r.ok ? r.json() : null))
      .then((cal) => {
        if (!active || !cal?.events) return;
        const hi = (cal.events as Array<{ time: string; title: string; impact: string }>)
          .filter((e) => e.impact === "high")
          .map((e) => ({ time: e.time, title: e.title }));
        setHighImpactEvents(hi);
      })
      .catch(() => {
        // Calendar fetch failed - no warning, not fatal.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!form.opened_at || highImpactEvents.length === 0) {
      setNewsWarning(null);
      return;
    }
    const t = Date.parse(localInputToIso(form.opened_at));
    if (Number.isNaN(t)) {
      setNewsWarning(null);
      return;
    }
    const windowMs = 2 * 60 * 60_000; // ±2h
    const near = highImpactEvents.find((e) => {
      const et = Date.parse(e.time);
      return !Number.isNaN(et) && Math.abs(et - t) <= windowMs;
    });
    setNewsWarning(
      near
        ? `High-impact event "${near.title}" within ±2h of this trade's open time. Consider skipping or reducing size.`
        : null,
    );
  }, [form.opened_at, highImpactEvents]);

  // ---- Position-sizing calculator (Feature 1) ----
  // Derived from account_balance + risk_pct + entry/stop distance, using
  // the same pure positionSize() the risk-calculator page uses. The
  // user clicks "Apply" to fill lot_size + risk_amount in one go.
  const calcInputs = (() => {
    const balance = Number(form.account_balance);
    const riskPct = Number(form.risk_pct);
    const entry = Number(form.entry_price);
    const sl = Number(form.stop_loss);
    if (
      !isFinite(balance) || balance <= 0 ||
      !isFinite(riskPct) || riskPct <= 0 ||
      !isFinite(entry) || entry <= 0 ||
      !isFinite(sl) || sl <= 0 ||
      entry === sl
    ) {
      return null;
    }
    const stopPips = priceDiffInPips(form.pair, entry, sl);
    const pipValue = pipValuePerLot(form.pair, entry);
    if (!isFinite(stopPips) || stopPips <= 0 || !isFinite(pipValue) || pipValue <= 0) {
      return null;
    }
    const lots = positionSize(balance, riskPct, stopPips, pipValue);
    const riskAmount = balance * (riskPct / 100);
    return { lots, riskAmount, stopPips, pipValue };
  })();

  const applyPositionSize = () => {
    if (!calcInputs) return;
    setForm((f) => ({
      ...f,
      lot_size: calcInputs.lots.toFixed(2),
      risk_amount: calcInputs.riskAmount.toFixed(2),
    }));
  };

  // ---- Screenshot upload (Feature 2) ----
  // Uploads to the `trade-screenshots` Storage bucket under
  // `<uid>/<timestamp>-<before|after>.png`. RLS ensures only the owner
  // can write to their prefix. The returned public URL is stored on the
  // trade row.
  const [uploading, setUploading] = useState<"before" | "after" | null>(null);

  const uploadScreenshot = async (
    file: File,
    which: "before" | "after",
  ) => {
    setUploading(which);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) {
        setFormError("You must be signed in to upload screenshots.");
        return;
      }
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${uid}/${Date.now()}-${which}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("trade-screenshots")
        .upload(path, file, { upsert: false });
      if (upErr) {
        setFormError(`Screenshot upload failed: ${upErr.message}`);
        return;
      }
      const { data: pub } = supabase.storage
        .from("trade-screenshots")
        .getPublicUrl(path);
      const url = pub.publicUrl;
      setForm((f) => ({
        ...f,
        [which === "before" ? "screenshot_url" : "screenshot_after_url"]: url,
      }));
    } catch (err) {
      setFormError(
        err instanceof Error ? `Upload error: ${err.message}` : "Upload failed.",
      );
    } finally {
      setUploading(null);
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  // --- Tags input (chips) ---
  // The user types in <input>; pressing Enter or comma "commits" the
  // current text as one or more tags (normalizeTags splits on commas /
  // whitespace, slugifies, dedupes). Backspace on an empty input
  // removes the last chip. Tags are capped at MAX_TAGS.
  const [tagDraft, setTagDraft] = useState("");

  const commitTagDraft = () => {
    const trimmed = tagDraft.trim();
    if (trimmed === "") return;
    const newTags = normalizeTags([trimmed]);
    if (newTags.length === 0) {
      setTagDraft("");
      return;
    }
    setForm((f) => {
      const existing = new Set(f.tags);
      const merged = [...f.tags];
      for (const t of newTags) {
        if (existing.has(t)) continue;
        if (merged.length >= MAX_TAGS) break;
        existing.add(t);
        merged.push(t);
      }
      return { ...f, tags: merged };
    });
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  };

  const onTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      // Prevent form submit on Enter; commit the draft instead.
      e.preventDefault();
      commitTagDraft();
      return;
    }
    if (
      e.key === "Backspace" &&
      tagDraft === "" &&
      form.tags.length > 0
    ) {
      // Backspace on empty input removes the last chip.
      e.preventDefault();
      setForm((f) => ({ ...f, tags: f.tags.slice(0, -1) }));
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Build the payload expected by the API.
    const payload: Record<string, unknown> = {
      pair: form.pair,
      direction: form.direction,
      entry_price: Number(form.entry_price),
      stop_loss: Number(form.stop_loss),
      lot_size: Number(form.lot_size),
      opened_at: form.opened_at ? localInputToIso(form.opened_at) : "",
      followed_plan: form.followed_plan,
    };
    if (form.exit_price) payload.exit_price = Number(form.exit_price);
    if (form.take_profit) payload.take_profit = Number(form.take_profit);
    if (form.closed_at) payload.closed_at = localInputToIso(form.closed_at);
    if (form.pnl !== "") payload.pnl = Number(form.pnl);
    if (form.strategy.trim()) payload.strategy = form.strategy.trim();
    if (form.session) payload.session = form.session;
    if (form.emotion.trim()) payload.emotion = form.emotion.trim();
    if (form.notes.trim()) payload.notes = form.notes.trim();
    // Always send tags (the schema defaults to [], but sending it
    // explicitly lets an edit clear all tags by sending []).
    payload.tags = form.tags;

    // Risk-management fields (Feature 1).
    if (form.account_balance) payload.account_balance = Number(form.account_balance);
    if (form.risk_pct) payload.risk_pct = Number(form.risk_pct);
    if (form.risk_amount) payload.risk_amount = Number(form.risk_amount);
    if (form.timeframe) payload.timeframe = form.timeframe;
    // Psychology + screenshots (Feature 2).
    if (form.mistake_type) payload.mistake_type = form.mistake_type;
    if (form.screenshot_url) payload.screenshot_url = form.screenshot_url;
    if (form.screenshot_after_url) payload.screenshot_after_url = form.screenshot_after_url;

    setSubmitting(true);
    try {
      const url = isEdit ? `/api/trades/${initial!.id}` : "/api/trades";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 400 && body?.error) {
          // Try to parse the API's "field: message; field2: message2" format
          // back into fieldErrors so they render inline.
          const errs: FieldErrors = {};
          for (const part of String(body.error).split(";")) {
            const m = part.trim().match(/^([^:]+):\s*(.+)$/);
            if (m) errs[m[1]] = m[2];
          }
          if (Object.keys(errs).length > 0) {
            setFieldErrors(errs);
          } else {
            setFormError(body.error);
          }
        } else if (res.status === 401) {
          setFormError("Your session has expired. Please sign in again.");
        } else {
          setFormError(body?.error ?? "Failed to save trade. Please try again.");
        }
        return;
      }

      const saved: TradeRow = await res.json();
      onSaved(saved);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? `Network error: ${err.message}`
          : "Network error - please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{formError}</span>
        </div>
      )}

      {/* News-aware risk overlay (Feature 4) */}
      {newsWarning && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        >
          <Newspaper className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{newsWarning}</span>
        </div>
      )}

      {/* Pair + Direction */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pair">Pair</Label>
          <Select value={form.pair} onValueChange={(v) => set("pair", v)}>
            <SelectTrigger id="pair">
              <SelectValue placeholder="Select pair" />
            </SelectTrigger>
            <SelectContent>
              {PAIRS.map((p) => (
                <SelectItem key={p} value={p}>
                  {formatPair(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.pair && (
            <p className="text-xs text-destructive">{fieldErrors.pair}</p>
          )}
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
              aria-label="Buy"
            >
              Buy
            </ToggleGroupItem>
            <ToggleGroupItem
              value="sell"
              className="flex-1 data-[state=on]:bg-rose-600 data-[state=on]:text-white"
              aria-label="Sell"
            >
              Sell
            </ToggleGroupItem>
          </ToggleGroup>
          {fieldErrors.direction && (
            <p className="text-xs text-destructive">{fieldErrors.direction}</p>
          )}
        </div>
      </div>

      {/* Entry / Exit / SL / TP */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
            aria-invalid={Boolean(fieldErrors.entry_price)}
          />
          {fieldErrors.entry_price && (
            <p className="text-xs text-destructive">{fieldErrors.entry_price}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exit">Exit (optional)</Label>
          <Input
            id="exit"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="1.0920"
            value={form.exit_price}
            onChange={(e) => set("exit_price", e.target.value)}
          />
          {fieldErrors.exit_price && (
            <p className="text-xs text-destructive">{fieldErrors.exit_price}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sl">Stop loss</Label>
          <Input
            id="sl"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="1.0800"
            value={form.stop_loss}
            onChange={(e) => set("stop_loss", e.target.value)}
            aria-invalid={Boolean(fieldErrors.stop_loss)}
          />
          {fieldErrors.stop_loss && (
            <p className="text-xs text-destructive">{fieldErrors.stop_loss}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tp">Take profit</Label>
          <Input
            id="tp"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="1.1000"
            value={form.take_profit}
            onChange={(e) => set("take_profit", e.target.value)}
          />
          {fieldErrors.take_profit && (
            <p className="text-xs text-destructive">{fieldErrors.take_profit}</p>
          )}
        </div>
      </div>

      {/* Lot size + PnL */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="lots">Lot size</Label>
          <Input
            id="lots"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder="0.50"
            value={form.lot_size}
            onChange={(e) => set("lot_size", e.target.value)}
            aria-invalid={Boolean(fieldErrors.lot_size)}
          />
          {fieldErrors.lot_size && (
            <p className="text-xs text-destructive">{fieldErrors.lot_size}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pnl">PnL ($)</Label>
          <Input
            id="pnl"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="auto-filled when exit is set"
            value={form.pnl}
            onChange={(e) => {
              setUserTypedPnl(true);
              set("pnl", e.target.value);
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Auto-suggested from entry, exit, lots. Edit if you prefer.
          </p>
          {fieldErrors.pnl && (
            <p className="text-xs text-destructive">{fieldErrors.pnl}</p>
          )}
        </div>
      </div>

      {/* Position-sizing calculator (Feature 1) */}
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Calculator className="h-4 w-4 text-primary" aria-hidden="true" />
          Position-size calculator
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label htmlFor="balance" className="text-xs">Account balance ($)</Label>
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
          <div className="space-y-1">
            <Label htmlFor="riskpct" className="text-xs">Risk %</Label>
            <Input
              id="riskpct"
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="1.0"
              value={form.risk_pct}
              onChange={(e) => set("risk_pct", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="riskamt" className="text-xs">Risk amount ($)</Label>
            <Input
              id="riskamt"
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="100"
              value={form.risk_amount}
              onChange={(e) => set("risk_amount", e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={applyPositionSize}
              disabled={!calcInputs}
              className="w-full"
            >
              Apply lot size
            </Button>
          </div>
        </div>
        {calcInputs ? (
          <p className="text-[11px] text-muted-foreground">
            SL = {calcInputs.stopPips.toFixed(0)} pips · pip value ${calcInputs.pipValue.toFixed(2)} →
            suggested <span className="font-medium text-foreground">{calcInputs.lots.toFixed(2)} lots</span>{" "}
            (${calcInputs.riskAmount.toFixed(2)} at risk).
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Enter balance, risk %, entry and stop loss to auto-compute lot size.
          </p>
        )}
      </div>

      {/* Opened / Closed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="opened">Opened at</Label>
          <Input
            id="opened"
            type="datetime-local"
            value={form.opened_at}
            onChange={(e) => set("opened_at", e.target.value)}
            aria-invalid={Boolean(fieldErrors.opened_at)}
          />
          {fieldErrors.opened_at && (
            <p className="text-xs text-destructive">{fieldErrors.opened_at}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="closed">Closed at (optional)</Label>
          <Input
            id="closed"
            type="datetime-local"
            value={form.closed_at}
            onChange={(e) => set("closed_at", e.target.value)}
          />
          {fieldErrors.closed_at && (
            <p className="text-xs text-destructive">{fieldErrors.closed_at}</p>
          )}
        </div>
      </div>

      {/* Strategy / Session / Emotion */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="strategy">Strategy</Label>
          <Input
            id="strategy"
            placeholder="trend / breakout / fade"
            value={form.strategy}
            onChange={(e) => set("strategy", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="session">Session</Label>
          <Select
            value={form.session}
            onValueChange={(v) => set("session", v === "none" ? "" : v)}
          >
            <SelectTrigger id="session">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— (none)</SelectItem>
              {SESSIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emotion">Emotion</Label>
          <Input
            id="emotion"
            placeholder="calm / FOMO / revenge"
            value={form.emotion}
            onChange={(e) => set("emotion", e.target.value)}
          />
        </div>
      </div>

      {/* Timeframe + Mistake type (Features 1 + 2) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="timeframe">Timeframe</Label>
          <Select
            value={form.timeframe || "none"}
            onValueChange={(v) => set("timeframe", v === "none" ? "" : v)}
          >
            <SelectTrigger id="timeframe">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— (none)</SelectItem>
              {TIMEFRAMES.map((tf) => (
                <SelectItem key={tf} value={tf}>{tf}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mistake">Execution mistake</Label>
          <Select
            value={form.mistake_type || "none"}
            onValueChange={(v) => set("mistake_type", v === "none" ? "" : v)}
          >
            <SelectTrigger id="mistake">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— none / clean</SelectItem>
              {MISTAKE_TYPES.filter((m) => m !== "none").map((m) => (
                <SelectItem key={m} value={m}>
                  {m.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          rows={3}
          placeholder="What was your thesis? What did you learn?"
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
        {fieldErrors.notes && (
          <p className="text-xs text-destructive">{fieldErrors.notes}</p>
        )}
      </div>

      {/* Chart screenshots (Feature 2) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="shot-before" className="flex items-center gap-1.5">
            <Camera className="h-3.5 w-3.5" aria-hidden="true" /> Before screenshot
          </Label>
          {form.screenshot_url ? (
            <div className="flex items-center gap-2">
              <a
                href={form.screenshot_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary underline truncate"
              >
                View uploaded chart
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set("screenshot_url", "")}
              >
                Remove
              </Button>
            </div>
          ) : (
            <Input
              id="shot-before"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadScreenshot(f, "before");
              }}
            />
          )}
          {uploading === "before" && (
            <p className="text-[11px] text-muted-foreground">Uploading…</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shot-after" className="flex items-center gap-1.5">
            <Camera className="h-3.5 w-3.5" aria-hidden="true" /> After screenshot
          </Label>
          {form.screenshot_after_url ? (
            <div className="flex items-center gap-2">
              <a
                href={form.screenshot_after_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary underline truncate"
              >
                View uploaded chart
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set("screenshot_after_url", "")}
              >
                Remove
              </Button>
            </div>
          ) : (
            <Input
              id="shot-after"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadScreenshot(f, "after");
              }}
            />
          )}
          {uploading === "after" && (
            <p className="text-[11px] text-muted-foreground">Uploading…</p>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-1.5">
        <Label htmlFor="tags">Tags</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
          {form.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
            >
              <Hash className="h-3 w-3" aria-hidden="true" />
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:bg-primary/20"
                aria-label={`Remove tag ${tag}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {form.tags.length < MAX_TAGS && (
            <input
              id="tags"
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={onTagKeyDown}
              onBlur={commitTagDraft}
              placeholder={
                form.tags.length === 0
                  ? "fomc, breakout, trend..."
                  : "add tag (Enter or comma)"
              }
              className="min-w-[120px] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground focus:ring-0"
              aria-label="Add tag"
            />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Press Enter or comma to add. Up to {MAX_TAGS} tags. Letters,
          numbers, dashes, underscores; spaces become dashes.
        </p>
        {fieldErrors.tags && (
          <p className="text-xs text-destructive">{fieldErrors.tags}</p>
        )}
      </div>

      {/* Followed plan */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="followed-plan"
          checked={form.followed_plan}
          onCheckedChange={(v) => set("followed_plan", v === true)}
        />
        <Label htmlFor="followed-plan" className="cursor-pointer text-sm font-normal">
          I followed my trading plan on this one
        </Label>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {isEdit ? "Saving..." : "Adding..."}
            </>
          ) : isEdit ? (
            "Save changes"
          ) : (
            "Add trade"
          )}
        </Button>
      </div>
    </form>
  );
}
