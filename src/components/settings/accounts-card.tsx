"use client";

/**
 * AccountsCard - manage trading accounts (feature 4).
 *
 * - Lists accounts (name, kind, trade count) with delete buttons.
 * - Create form: name + kind (live / demo / prop).
 * - Delete is rejected by the server while an account still has
 *   trades (the error surfaces inline).
 *
 * After any change the router refreshes so the sidebar switcher
 * (and any account-scoped pages) pick up the new list.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACCOUNT_KINDS, type AccountKind, type AccountRow } from "@/lib/accounts/schema";

export function AccountsCard() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("live");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/accounts");
      if (res.ok) {
        const body = (await res.json()) as { accounts: AccountRow[] };
        setAccounts(body.accounts ?? []);
      }
    } catch {
      // Keep whatever we had.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setName("");
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account.");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/accounts?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account.");
    }
  };

  return (
    <Card id="accounts">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Trading accounts</CardTitle>
        <p className="text-xs text-muted-foreground">
          Keep separate logs for your live, demo, and prop-firm accounts.
          Stats, the journal, and AI reviews follow the account selected
          in the sidebar.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : (
            accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{a.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {a.kind}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {a.trade_count} trade{a.trade_count === 1 ? "" : "s"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => void remove(a.id)}
                  aria-label={`Delete ${a.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>

        <form onSubmit={create} className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">New account</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FTMO challenge"
              maxLength={40}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as AccountKind)}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-8" disabled={creating || !name.trim()}>
            {creating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3.5 w-3.5" />
            )}
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
