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
import { Loader2, AlertTriangle, X, Hash } from "lucide-react";
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
  formatPair,
  normalizeTags,
  MAX_TAGS,
  type TradeRow,
} from "@/lib/trades/schema";
import {
  pipSize,
  priceDiffInPips,
  pipValuePerLot,
} from "@/lib/risk";

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
