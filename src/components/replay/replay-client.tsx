"use client";

/**
 * Trade Replay - what-if simulator.
 *
 * Pick one of your recent closed trades, then adjust entry/SL/TP/exit/
 * lot to see what the PnL, RR and risk amount would have been.
 *
 * Pure math, no AI, no persistence. Everything is computed client-side
 * from the loaded trade list using computeReplay().
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { GitCompareArrows, Loader2, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  computeReplay,
  formatDollars,
  formatPips,
  type ReplayInput,
} from "@/lib/replay/replay";
import {
  formatPair,
  formatMoney,
  type TradeListResponse,
  type TradeRow,
} from "@/lib/trades/schema";
import { cn } from "@/lib/utils";

type AdjustedForm = {
  entry_price: string;
  stop_loss: string;
  take_profit: string;
  exit_price: string;
  lot_size: string;
};

function tradeToForm(t: TradeRow): AdjustedForm {
  return {
    entry_price: String(t.entry_price),
    stop_loss: String(t.stop_loss),
    take_profit: t.take_profit != null ? String(t.take_profit) : "",
    exit_price: t.exit_price != null ? String(t.exit_price) : "",
    lot_size: String(t.lot_size),
  };
}

export function ReplayClient() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");

  const closedTrades = useMemo(
    () => trades.filter((t) => t.pnl != null),
    [trades],
  );

  const selected = useMemo(
    () => closedTrades.find((t) => t.id === selectedId) ?? null,
    [closedTrades, selectedId],
  );

  const [form, setForm] = useState<AdjustedForm | null>(null);

  const load = useCallback(async () => {
    setLoaded(false);
    try {
      const res = await fetch("/api/trades?limit=100");
      if (res.status === 401) {
        setAuthRequired(true);
        return;
      }
      if (!res.ok) return;
      const data: TradeListResponse = await res.json();
      setTrades(data.trades);
      // Auto-select the first closed trade.
      const firstClosed = data.trades.find((t) => t.pnl != null);
      if (firstClosed) {
        setSelectedId(firstClosed.id);
        setForm(tradeToForm(firstClosed));
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSelect = (id: string) => {
    setSelectedId(id);
    const t = closedTrades.find((x) => x.id === id);
    if (t) setForm(tradeToForm(t));
  };

  const adjusted: ReplayInput | null = useMemo(() => {
    if (!selected || !form) return null;
    const entry = Number(form.entry_price);
    const sl = Number(form.stop_loss);
    const tp = form.take_profit.trim() === "" ? null : Number(form.take_profit);
    const exit = form.exit_price.trim() === "" ? null : Number(form.exit_price);
    const lot = Number(form.lot_size);
    if (!isFinite(entry) || !isFinite(sl) || !isFinite(lot)) return null;
    return {
      pair: selected.pair,
      direction: selected.direction,
      entry_price: entry,
      stop_loss: sl,
      take_profit: tp,
      exit_price: exit,
      lot_size: lot,
    };
  }, [selected, form]);

  const result = useMemo(
    () => (selected && adjusted ? computeReplay(selected, adjusted) : null),
    [selected, adjusted],
  );

  if (authRequired) {
    return (
      <div className="space-y-6">
        <PageHeader title="Trade Replay" icon={<GitCompareArrows className="h-5 w-5" />} />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Sign in to replay your trades.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade Replay"
        description="Pick a past trade and tweak the prices or lot size to see what the PnL, RR and risk amount would have been. Pure math - no AI, no judgement. Useful for asking 'what if I'd held for the target?' or 'what if my stop was tighter?'"
        icon={<GitCompareArrows className="h-5 w-5" />}
      />

      {!loaded ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : closedTrades.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No closed trades to replay yet. Log a trade in the journal first.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          {/* Left: picker + form */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pick a trade</CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={selectedId} onValueChange={onSelect}>
                  <SelectTrigger aria-label="Pick a trade to replay">
                    <SelectValue placeholder="Select a trade..." />
                  </SelectTrigger>
                  <SelectContent>
                    {closedTrades.slice(0, 50).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {formatPair(t.pair)} {t.direction} -{" "}
                        {t.opened_at.slice(0, 10)} -{" "}
                        {formatMoney(t.pnl)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {selected && form && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">What-if scenario</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm(tradeToForm(selected))}
                    >
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                      Reset
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Entry</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        value={form.entry_price}
                        onChange={(e) =>
                          setForm((f) => ({ ...f!, entry_price: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Stop loss</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        value={form.stop_loss}
                        onChange={(e) =>
                          setForm((f) => ({ ...f!, stop_loss: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Take profit</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        value={form.take_profit}
                        onChange={(e) =>
                          setForm((f) => ({ ...f!, take_profit: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Exit (what-if)</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        value={form.exit_price}
                        onChange={(e) =>
                          setForm((f) => ({ ...f!, exit_price: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Lot size</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={form.lot_size}
                        onChange={(e) =>
                          setForm((f) => ({ ...f!, lot_size: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Badge variant="outline">
                      {formatPair(selected.pair)}
                    </Badge>
                    <Badge
                      className={
                        selected.direction === "buy"
                          ? "bg-emerald-600 text-white"
                          : "bg-rose-600 text-white"
                      }
                    >
                      {selected.direction.toUpperCase()}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: results */}
          <div className="space-y-4">
            {result ? (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">PnL comparison</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <div className="text-xs text-muted-foreground">Original</div>
                        <div
                          className={cn(
                            "text-lg font-semibold tabular-nums",
                            (result.originalPnl ?? 0) > 0
                              ? "text-emerald-500"
                              : (result.originalPnl ?? 0) < 0
                                ? "text-rose-500"
                                : "text-muted-foreground",
                          )}
                        >
                          {formatDollars(result.originalPnl)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">What-if</div>
                        <div
                          className={cn(
                            "text-lg font-semibold tabular-nums",
                            (result.adjustedPnl ?? 0) > 0
                              ? "text-emerald-500"
                              : (result.adjustedPnl ?? 0) < 0
                                ? "text-rose-500"
                                : "text-muted-foreground",
                          )}
                        >
                          {formatDollars(result.adjustedPnl)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Delta</div>
                        <div
                          className={cn(
                            "text-lg font-semibold tabular-nums",
                            (result.pnlDelta ?? 0) > 0
                              ? "text-emerald-500"
                              : (result.pnlDelta ?? 0) < 0
                                ? "text-rose-500"
                                : "text-muted-foreground",
                          )}
                        >
                          {formatDollars(result.pnlDelta)}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Risk / reward</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div>
                        <div className="text-xs text-muted-foreground">Original RR</div>
                        <div className="text-lg font-semibold tabular-nums">
                          {Number.isNaN(result.originalRR)
                            ? "—"
                            : result.originalRR.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">What-if RR</div>
                        <div className="text-lg font-semibold tabular-nums">
                          {Number.isNaN(result.adjustedRR)
                            ? "—"
                            : result.adjustedRR.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Leg breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="pb-2 font-medium">Leg</th>
                          <th className="pb-2 text-right font-medium">Pips</th>
                          <th className="pb-2 text-right font-medium">$</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-border/50">
                          <td className="py-2">Entry → SL (risk)</td>
                          <td className="py-2 text-right tabular-nums">
                            {formatPips(result.riskLeg.pips)}
                          </td>
                          <td className="py-2 text-right tabular-nums font-medium text-rose-500">
                            {formatDollars(-Math.abs(result.riskLeg.dollars))}
                          </td>
                        </tr>
                        {result.rewardLeg && (
                          <tr className="border-t border-border/50">
                            <td className="py-2">Entry → TP (target)</td>
                            <td className="py-2 text-right tabular-nums">
                              {formatPips(result.rewardLeg.pips)}
                            </td>
                            <td className="py-2 text-right tabular-nums font-medium text-emerald-500">
                              {formatDollars(Math.abs(result.rewardLeg.dollars))}
                            </td>
                          </tr>
                        )}
                        {result.realizedLeg && (
                          <tr className="border-t border-border/50">
                            <td className="py-2">Entry → Exit (realized)</td>
                            <td className="py-2 text-right tabular-nums">
                              {formatPips(result.realizedLeg.pips)}
                            </td>
                            <td
                              className={cn(
                                "py-2 text-right tabular-nums font-medium",
                                result.realizedLeg.dollars >= 0
                                  ? "text-emerald-500"
                                  : "text-rose-500",
                              )}
                            >
                              {formatDollars(result.realizedLeg.dollars)}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  Adjust the form on the left to see the what-if math.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Advisory only. Replay is for learning, not for second-guessing every
        closed trade. The decision you made at the time was made with the
        information you had then.
      </p>
    </div>
  );
}
