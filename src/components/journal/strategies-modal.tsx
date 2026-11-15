"use client";

/**
 * StrategiesModal - manage the user's strategy library (Dialog).
 *
 * The library is a first-class entity: Strategy rows in the DB that
 * trades reference via FK. This modal lists them (with trade counts),
 * lets the user add / rename / describe / delete them.
 *
 * Dynamic behavior:
 *  - Opening the list auto-backfills legacy free-text strategy values
 *    into library rows (server-side), so nothing is ever lost.
 *  - Deleting a strategy unlinks its trades (they keep the text
 *    value, so analytics history survives).
 *  - The trade form's suggestions read from this library.
 */
import { useEffect, useState, FormEvent } from "react";
import { Loader2, Plus, Trash2, Pencil, Check, X, Target } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { StrategyRow } from "@/lib/strategies/schema";

export function StrategiesModal({
  open,
  onOpenChange,
  /** Called after any library change so parents can refresh. */
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit state (one row at a time)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/strategies");
      if (res.ok) {
        const body = (await res.json()) as { strategies: StrategyRow[] };
        setStrategies(body.strategies ?? []);
      }
    } catch {
      // Keep whatever we had.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setName("");
      setDescription("");
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create strategy.");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (s: StrategyRow) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditDescription(s.description ?? "");
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/strategies?id=${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update strategy.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: StrategyRow) => {
    setError(null);
    try {
      const res = await fetch(`/api/strategies?id=${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete strategy.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" /> Strategy library
          </DialogTitle>
          <DialogDescription>
            Your trading systems. Trades link to these — stats per
            strategy appear on the Analytics page. Deleting one unlinks
            its trades but keeps their history.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {/* List */}
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : strategies.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No strategies yet. Add your first below — or just type one
              when logging a trade and it lands here automatically.
            </p>
          ) : (
            strategies.map((s) =>
              editingId === s.id ? (
                <div key={s.id} className="space-y-1.5 rounded-md border border-primary/40 p-2.5">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={60}
                    className="h-8 text-sm"
                    aria-label="Strategy name"
                  />
                  <Input
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    maxLength={500}
                    placeholder="How it works (optional)"
                    className="h-8 text-xs"
                    aria-label="Strategy description"
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Cancel
                    </Button>
                    <Button size="sm" className="h-7" onClick={() => void saveEdit()} disabled={saving}>
                      <Check className="mr-1 h-3.5 w-3.5" /> Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  key={s.id}
                  className="group flex items-start justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{s.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {s.trade_count} trade{s.trade_count === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    {s.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {s.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => startEdit(s)}
                      aria-label={`Edit ${s.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => void remove(s)}
                      aria-label={`Delete ${s.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ),
            )
          )}
        </div>

        {/* Add form */}
        <form onSubmit={create} className="space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="space-y-1">
            <Label className="text-xs">New strategy</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. London breakout"
              maxLength={60}
              className="h-8 text-sm"
            />
          </div>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="How it works (optional)"
            maxLength={500}
            className="h-8 text-xs"
          />
          <Button type="submit" size="sm" className="h-8 w-full" disabled={creating || !name.trim()}>
            {creating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3.5 w-3.5" />
            )}
            Add strategy
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
