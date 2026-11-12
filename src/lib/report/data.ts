/**
 * Report data preparation - pure functions.
 *
 * Turns a list of trades into the structured sections a PDF report
 * renders: summary stats, equity curve points, per-pair / per-tag /
 * per-session breakdowns. Pure + testable; the PDF renderer in
 * pdf.ts consumes this output.
 */
import type { TradeRow } from "@/lib/trades/schema";
import { computeStats, equityCurve, formatMoney, formatPct } from "@/lib/trades/schema";
import { perPairStats, perTagStats, perSessionStats } from "@/lib/trades/analytics";

export type ReportSummary = {
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  winners: number;
  losers: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  bestPair: string | null;
  worstPair: string | null;
};

export type ReportSection<T> = {
  title: string;
  rows: T[];
};

export type PairRow = {
  pair: string;
  trades: number;
  winRate: number;
  netPnl: number;
};

export type TagRow = {
  tag: string;
  trades: number;
  winRate: number;
  netPnl: number;
};

export type SessionRow = {
  session: string;
  trades: number;
  winRate: number;
  netPnl: number;
};

export type EquityPoint = { at: string; equity: number };

export type ReportData = {
  summary: ReportSummary;
  equityCurve: EquityPoint[];
  pairs: ReportSection<PairRow>;
  tags: ReportSection<TagRow>;
  sessions: ReportSection<SessionRow>;
};

/** Build the full report data from a list of trades. Pure. */
export function buildReportData(
  trades: TradeRow[],
  windowStart: string,
  windowEnd: string,
  generatedAt: string = new Date().toISOString(),
): ReportData {
  const stats = computeStats(trades);
  const pairs = perPairStats(trades);
  const tags = perTagStats(trades);
  const sessions = perSessionStats(trades);
  const equity = equityCurve(trades);

  const summary: ReportSummary = {
    windowStart,
    windowEnd,
    generatedAt,
    totalTrades: trades.length,
    closedTrades: stats.closed,
    openTrades: stats.total - stats.closed,
    winners: stats.winners,
    losers: stats.losers,
    winRate: stats.winRate,
    netPnl: stats.netPnl,
    profitFactor: stats.profitFactor,
    avgWin: stats.avgWin,
    avgLoss: stats.avgLoss,
    bestPair: pairs.length > 0 ? pairs[0]!.pair : null,
    worstPair: pairs.length > 0 ? pairs[pairs.length - 1]!.pair : null,
  };

  return {
    summary,
    equityCurve: equity.map((p) => ({ at: p.at, equity: p.equity })),
    pairs: {
      title: "Per-pair breakdown",
      rows: pairs.map((p) => ({
        pair: p.pair,
        trades: p.total,
        winRate: p.winRate,
        netPnl: p.netPnl,
      })),
    },
    tags: {
      title: "Per-tag breakdown",
      rows: tags.map((t) => ({
        tag: t.tag,
        trades: t.total,
        winRate: t.winRate,
        netPnl: t.netPnl,
      })),
    },
    sessions: {
      title: "Per-session breakdown",
      rows: sessions.map((s) => ({
        session: String(s.session),
        trades: s.total,
        winRate: s.winRate,
        netPnl: s.netPnl,
      })),
    },
  };
}

/** Format the summary for display. Pure. */
export function formatSummaryLines(s: ReportSummary): string[] {
  return [
    `Window: ${s.windowStart.slice(0, 10)} to ${s.windowEnd.slice(0, 10)}`,
    `Generated: ${s.generatedAt.slice(0, 19).replace("T", " ")} UTC`,
    `Total trades: ${s.totalTrades} (${s.closedTrades} closed, ${s.openTrades} open)`,
    `Win rate: ${formatPct(s.winRate)} (${s.winners}W / ${s.losers}L)`,
    `Net PnL: ${formatMoney(s.netPnl)}`,
    `Profit factor: ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "—"}`,
    `Avg win: ${formatMoney(s.avgWin)} / Avg loss: ${formatMoney(s.avgLoss)}`,
    s.bestPair ? `Best pair: ${s.bestPair}` : "Best pair: —",
    s.worstPair ? `Worst pair: ${s.worstPair}` : "Worst pair: —",
  ];
}
