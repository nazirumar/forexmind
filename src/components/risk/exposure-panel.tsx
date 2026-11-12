"use client";

/**
 * Exposure & correlation panel (Feature 3).
 *
 * Shows the user's OPEN positions as:
 *  - net directional exposure per currency (am I long USD? short EUR?)
 *  - correlated over-exposure warnings (long EURUSD + long GBPUSD = doubled)
 *
 * Pure data arrives as props from the server page
 * (src/lib/trades/exposure.ts). This component only renders.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Layers } from "lucide-react";
import type {
  CurrencyExposure,
  CorrelationWarning,
  ExposureSummary,
} from "@/lib/trades/exposure";

function fmtLots(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

export function ExposurePanel({ summary }: { summary: ExposureSummary }) {
  if (summary.openCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Layers className="h-4 w-4" aria-hidden="true" /> Exposure
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No open positions. Your capital is flat — nothing at risk right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Headline */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Open positions</div>
            <div className="text-xl font-semibold">{summary.openCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Total lots</div>
            <div className="text-xl font-semibold">{summary.totalOpenLots.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Open risk</div>
            <div className="text-xl font-semibold">
              {summary.totalOpenRisk != null
                ? `$${summary.totalOpenRisk.toFixed(2)}`
                : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Correlation warnings */}
      {summary.warnings.length > 0 && (
        <div className="space-y-2">
          {summary.warnings.map((w, i) => (
            <div
              key={i}
              role="alert"
              className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Net exposure by currency */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Net exposure by currency</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1 font-medium">Currency</th>
                <th className="pb-1 font-medium text-right">Net lots</th>
                <th className="pb-1 font-medium text-right">Trades</th>
                <th className="pb-1 font-medium text-right">Open risk</th>
              </tr>
            </thead>
            <tbody>
              {summary.byCurrency.map((c: CurrencyExposure) => (
                <tr key={c.currency} className="border-t border-border/50">
                  <td className="py-1.5 font-medium">{c.currency}</td>
                  <td
                    className={`py-1.5 text-right tabular-nums ${
                      c.netLots > 0 ? "text-emerald-400" : c.netLots < 0 ? "text-rose-400" : ""
                    }`}
                  >
                    {fmtLots(c.netLots)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {c.trades}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {c.openRisk > 0 ? `$${c.openRisk.toFixed(0)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Positive = net long that currency, negative = net short. A large
            |net lots| in one currency means you&apos;re concentrated.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
