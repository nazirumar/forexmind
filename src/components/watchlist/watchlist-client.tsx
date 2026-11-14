"use client";

/**
 * Watchlist + Price Alerts page.
 *
 * Left column: the user's watched pairs with live rates (from
 * /api/prices). Add/remove pairs.
 * Right column: price alerts. Create an alert (pair + above/below +
 * threshold); each alert shows whether it's currently triggering
 * against the live rate. Delete alerts.
 *
 * No push notifications - the user has to visit the page to see
 * triggered alerts. A future phase could add email/webhook delivery.
 */
import { useCallback, useEffect, useMemo, useState, FormEvent } from "react";
import { Eye, Plus, Trash2, Bell, Loader2, BellRing, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PAIRS,
  checkAlert,
  type AlertRow,
  type WatchlistRow,
} from "@/lib/watchlist/schema";
import { formatPair } from "@/lib/trades/schema";
import type { PriceResponse, PriceQuote } from "@/lib/prices/schema";

export function WatchlistClient() {
  const [loaded, setLoaded] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [items, setItems] = useState<WatchlistRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  /** Alerts the server sweep has fired (triggered_at stamped). */
  const firedCount = alerts.filter((a) => a.triggered_at != null).length;
  const [prices, setPrices] = useState<Map<string, PriceQuote>>(new Map());
  const [pricesFetchedAt, setPricesFetchedAt] = useState<string | null>(null);
  const [pricesNote, setPricesNote] = useState<string | null>(null);

  const [newPair, setNewPair] = useState("EURUSD");

  // Alert form
  const [alertPair, setAlertPair] = useState("EURUSD");
  const [alertDir, setAlertDir] = useState<"above" | "below">("above");
  const [alertThreshold, setAlertThreshold] = useState("");

  const loadAll = useCallback(async () => {
    setLoaded(false);
    try {
      const [wlRes, alRes, prRes] = await Promise.all([
        fetch("/api/watchlist"),
        fetch("/api/watchlist/alerts"),
        fetch("/api/prices"),
      ]);
      if (wlRes.status === 401) {
        setAuthRequired(true);
        return;
      }
      const wlBody = await wlRes.json().catch(() => ({}));
      if (Array.isArray(wlBody.items)) setItems(wlBody.items);
      const alBody = await alRes.json().catch(() => ({}));
      if (Array.isArray(alBody.alerts)) setAlerts(alBody.alerts);
      const prBody: PriceResponse = await prRes.json().catch(() => null);
      if (prBody?.quotes) {
        setPrices(new Map(prBody.quotes.map((q) => [q.pair, q])));
        setPricesFetchedAt(prBody.fetched_at);
        setPricesNote(prBody.note ?? null);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const addPair = async () => {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair: newPair }),
    });
    if (res.ok) {
      const item: WatchlistRow = await res.json();
      setItems((prev) =>
        prev.some((x) => x.pair === item.pair) ? prev : [...prev, item],
      );
    }
  };

  const removePair = async (id: string) => {
    const res = await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const createAlert = async (e: FormEvent) => {
    e.preventDefault();
    const threshold = Number(alertThreshold);
    if (!isFinite(threshold) || threshold <= 0) return;
    const res = await fetch("/api/watchlist/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pair: alertPair,
        direction: alertDir,
        threshold,
      }),
    });
    if (res.ok) {
      const alert: AlertRow = await res.json();
      setAlerts((prev) => [alert, ...prev]);
      setAlertThreshold("");
    }
  };

  const deleteAlert = async (id: string) => {
    const res = await fetch(`/api/watchlist/alerts?id=${id}`, {
      method: "DELETE",
    });
    if (res.ok) setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  const watchedPairs = useMemo(
    () => items.map((i) => i.pair),
    [items],
  );
  const unwatchedPairs = useMemo(
    () => PAIRS.filter((p) => !watchedPairs.includes(p)),
    [watchedPairs],
  );

  if (authRequired) {
    return (
      <div className="space-y-6">
        <PageHeader title="Watchlist" icon={<Eye className="h-5 w-5" />} />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Sign in to use the watchlist.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Watchlist & Price Alerts"
        description="Track the pairs you care about and set price alerts. The server checks your alerts against live rates whenever prices refresh — fired alerts are highlighted below."
        icon={<Eye className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => void loadAll()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {/* Fired-alert banner: the server sweep fired these while you were away */}
      {firedCount > 0 && (
        <div
          className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2.5"
          role="alert"
        >
          <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-amber-200/90">
            <strong>
              {firedCount} alert{firedCount === 1 ? "" : "s"} fired
            </strong>{" "}
            since you set {firedCount === 1 ? "it" : "them"} — see the amber
            rows below. Advisory only: a triggered alert is not a signal to
            trade, it just means price crossed a level you chose to watch.
          </p>
        </div>
      )}

      {pricesNote && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {pricesNote}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Watchlist */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4" /> Watched pairs
            </CardTitle>
            {pricesFetchedAt && (
              <p className="text-xs text-muted-foreground">
                Rates fetched {new Date(pricesFetchedAt).toLocaleTimeString()}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {!loaded ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No pairs watched yet. Add one below.
              </p>
            ) : (
              <div className="space-y-1.5">
                {items.map((item) => {
                  const q = prices.get(item.pair);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="font-medium">
                        {formatPair(item.pair)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-muted-foreground">
                          {q ? q.rate.toFixed(pipDigits(item.pair)) : "—"}
                        </span>
                        {q?.stale && (
                          <Badge variant="outline" className="text-[10px]">
                            stale
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => void removePair(item.id)}
                          aria-label={`Remove ${item.pair}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add pair */}
            <div className="flex items-end gap-2 pt-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Add a pair</Label>
                <Select value={newPair} onValueChange={setNewPair}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unwatchedPairs.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        All pairs watched
                      </SelectItem>
                    ) : (
                      unwatchedPairs.map((p) => (
                        <SelectItem key={p} value={p}>
                          {formatPair(p)}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={() => void addPair()}
                disabled={unwatchedPairs.length === 0}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" /> Price alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Create alert form */}
            <form onSubmit={createAlert} className="space-y-2 rounded-md border p-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Pair</Label>
                  <Select value={alertPair} onValueChange={setAlertPair}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAIRS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {formatPair(p)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Direction</Label>
                  <Select
                    value={alertDir}
                    onValueChange={(v) => setAlertDir(v as "above" | "below")}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="above">Above</SelectItem>
                      <SelectItem value="below">Below</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Threshold</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="e.g. 1.10"
                    value={alertThreshold}
                    onChange={(e) => setAlertThreshold(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <Button type="submit" size="sm" className="w-full">
                <Plus className="mr-1 h-4 w-4" />
                Create alert
              </Button>
            </form>

            {/* Alert list */}
            {!loaded ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No alerts set.
              </p>
            ) : (
              <div className="space-y-1.5">
                {alerts.map((a) => {
                  const q = prices.get(a.pair);
                  // Authoritative: the server sweep stamped triggered_at
                  // (this is how alerts fire while you're away). The live
                  // check is instant feedback for thresholds crossed right now.
                  const fired = a.triggered_at != null;
                  const triggeringNow = !fired && q ? checkAlert(a, q.rate) : false;
                  const triggered = fired || triggeringNow;
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                        triggered ? "border-amber-500/40 bg-amber-500/[0.06]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {triggered ? (
                          <BellRing className="h-4 w-4 text-amber-500" />
                        ) : (
                          <Bell className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium">
                          {formatPair(a.pair)}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {a.direction} {a.threshold}
                        </Badge>
                        {fired && a.triggered_at && (
                          <Badge className="bg-amber-500 text-[10px] text-black">
                            Fired {formatDateShort(a.triggered_at)}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          now: {q ? q.rate.toFixed(pipDigits(a.pair)) : "—"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => void deleteAlert(a.id)}
                          aria-label="Delete alert"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Advisory only. A triggered alert is not a signal to trade. It just means
        the price crossed a level you chose to watch.
      </p>
    </div>
  );
}

/** Digits after the decimal point to display for a pair's rate. */
function pipDigits(pair: string): number {
  if (pair.endsWith("JPY")) return 3;
  if (pair === "XAUUSD") return 2;
  return 5;
}

/** "Nov 14" style short date for the Fired badge. */
function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
