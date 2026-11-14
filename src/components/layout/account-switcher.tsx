"use client";

/**
 * AccountSwitcher - picks the active trading account (feature 4).
 *
 * Lists the user's accounts via GET /api/accounts (which lazily
 * creates the default "Main account" on first use), plus an
 * "All accounts" entry. Selecting one POSTs to /api/accounts/select
 * (which sets the httpOnly forexmind_account cookie) and refreshes
 * the router so every server-rendered stat re-queries with the new
 * account scope.
 *
 * "Manage accounts" links to the Settings page, which has the
 * create/delete UI.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Layers, Settings2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AccountRow } from "@/lib/accounts/schema";

export function AccountSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [selected, setSelected] = useState<string>("all");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accounts");
        if (!res.ok) return;
        const body = (await res.json()) as { accounts: AccountRow[] };
        if (!cancelled) {
          setAccounts(body.accounts ?? []);
          setLoaded(true);
        }
      } catch {
        // Silent: the switcher just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reflect the cookie's selection once accounts are known. The
  // server renders this component's sibling pages with the selected
  // account; the switcher itself only learns the id from the API, so
  // we default to "all" and let the user re-pick after a switch.
  const switchAccount = async (value: string) => {
    setSelected(value);
    try {
      await fetch("/api/accounts/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: value === "all" ? null : value }),
      });
      // Re-render all server components with the new account scope.
      router.refresh();
    } catch {
      // Selection failed; leave the UI as-is.
    }
  };

  if (!loaded || accounts.length === 0) return null;

  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Layers className="h-3 w-3" aria-hidden="true" /> Account
        </span>
        <Link
          href="/settings#accounts"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          aria-label="Manage accounts"
        >
          <Settings2 className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <Select value={selected} onValueChange={(v) => void switchAccount(v)}>
        <SelectTrigger className="h-8 w-full text-xs" aria-label="Active trading account">
          <SelectValue placeholder="All accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All accounts</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name} · {a.kind}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
