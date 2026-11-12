"use client";

/**
 * Trade Journal - main interactive surface.
 *
 * Responsibilities:
 *  - Fetch /api/trades on mount; render list + stats panel.
 *  - "Add trade" button opens a Dialog with <TradeForm/>.
 *  - Edit button per row opens the same dialog with initial values.
 *  - Delete button per row opens an AlertDialog confirm, then DELETEs.
 *  - Filter by pair + direction (client-side over the loaded page).
 *  - Graceful empty state and auth-error state (since the sandbox
 *    runs without real Supabase configured).
 *
 * State management is local React state - no global store needed for
 * a single-user journal whose row count rarely exceeds a few hundred.
 * When `optimisticTrades` is set (post-create / post-edit / post-delete),
 * we use it instead of re-fetching, to keep the UI snappy.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, AlertTriangle, BookOpen, RefreshCw, BarChart3, ListOrdered, Hash } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TradeForm } from "@/components/journal/trade-form";
import { StatsPanel } from "@/components/journal/stats-panel";
import { AnalyticsPanel } from "@/components/journal/analytics-panel";
import { JournalReviewPanel } from "@/components/journal/journal-review-panel";
import { ImportExportPanel } from "@/components/journal/import-export-panel";
import {
  computeStats,
  formatMoney,
  formatPair,
  formatDate,
  timeAgo,
  applyTradeFilter,
  isFilterEmpty,
  EMPTY_FILTER,
  OUTCOME_FILTERS,
  SESSIONS,
  type TradeRow,
  type TradeListResponse,
  type TradeStats,
  type TradeFilter,
  type OutcomeFilter,
  PAIRS,
} from "@/lib/trades/schema";
import { cn } from "@/lib/utils";

export function JournalClient() {
  const [loaded, setLoaded] = useState(false);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  /** Distinct tags the user has used, for the tag-filter dropdown. */
  const [allTags, setAllTags] = useState<string[]>([]);

  const [filter, setFilter] = useState<TradeFilter>(EMPTY_FILTER);
  const [view, setView] = useState<"trades" | "analytics">("trades");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TradeRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setAuthRequired(false);
    setLoaded(false);
    try {
      const res = await fetch("/api/trades");
      if (res.status === 401) {
        setAuthRequired(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to load trades (HTTP ${res.status})`);
      }
      const data: TradeListResponse = await res.json();
      setTrades(data.trades);
      setStats(data.stats);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load trades.",
      );
    } finally {
      setLoaded(true);
    }
  }, []);

  // Fetch the user's tag vocabulary in parallel with the trades list.
  // Non-fatal: if this fails we just render an empty tag dropdown.
  const loadTags = useCallback(async () => {
    try {
      const res = await fetch("/api/trades/tags");
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (Array.isArray(body?.tags)) setAllTags(body.tags as string[]);
    } catch {
      // ignore - dropdown just stays empty.
    }
  }, []);

  useEffect(() => {
    void load();
    void loadTags();
  }, [load, loadTags]);

  // Refresh the tag vocabulary whenever a trade is saved (so a newly
  // added tag appears in the filter dropdown without a manual refresh).
  const refreshTags = useCallback(() => {
    void loadTags();
  }, [loadTags]);

  // Apply client-side filters over the loaded page. The pure helper
  // mirrors the server-side filter in /api/trades, so a refetch with
  // query params would yield the same rows.
  const filtered = useMemo(() => applyTradeFilter(trades, filter), [trades, filter]);

  // Recompute stats over the filtered subset so the panel reflects
  // what the user is actually looking at.
  const filteredStats = useMemo(() => {
    if (!stats) return null;
    return computeStats(filtered);
  }, [filtered, stats]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (t: TradeRow) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const handleSaved = (saved: TradeRow) => {
    setDialogOpen(false);
    setEditing(null);
    setTrades((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      if (idx === -1) {
        // New trade: prepend (most recent first by created_at).
        return [saved, ...prev];
      }
      // Existing: replace in place. Re-sort by created_at desc.
      const next = [...prev];
      next[idx] = saved;
      return next.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    });
    // A new/edited trade may have introduced a tag we haven't seen yet.
    refreshTags();
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/trades/${deletingId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to delete (HTTP ${res.status})`);
      }
      setTrades((prev) => prev.filter((t) => t.id !== deletingId));
      setDeletingId(null);
    } catch (err) {
      console.error(err);
      setLoadError(
        err instanceof Error ? err.message : "Failed to delete trade.",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Trade Journal"
        description="Log trades, review win rate, profit factor and plan discipline. Numbers update as you filter."
        icon={<BookOpen className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={!loaded}
              aria-label="Refresh trades"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline ml-1">Refresh</span>
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1">Add trade</span>
            </Button>
          </div>
        }
      />

      {/* Auth-required banner (sandbox without Supabase configured). */}
      {authRequired && (
        <Card className="mt-6 border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-4 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">Sign in to use the journal.</p>
              <p className="text-xs opacity-90">
                The Trade Journal stores data in your Supabase account so
                only you can see it. Configure Supabase (see
                <code className="mx-1">docs/supabase-setup.md</code>) and
                sign in.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Load error */}
      {!authRequired && loadError && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Stats panel */}
      {!authRequired && filteredStats && (
        <div className="mt-6">
          <StatsPanel stats={filteredStats} />
        </div>
      )}

      {/* AI Journal Review - only show when user has any trades */}
      {!authRequired && loaded && trades.length > 0 && (
        <div className="mt-6">
          <JournalReviewPanel closedCount={filteredStats?.closed ?? 0} />
        </div>
      )}

      {/* Import/Export panel - always show when not auth-required so
          the user can download the template + see the format even
          before they have trades. */}
      {!authRequired && loaded && (
        <div className="mt-6">
          <ImportExportPanel onImported={load} />
        </div>
      )}

      {/* View toggle: Trades table vs Analytics charts */}
      {!authRequired && loaded && trades.length > 0 && (
        <div className="mt-6 flex items-center gap-1 rounded-md border border-border bg-card/40 p-1 w-fit">
          <button
            type="button"
            onClick={() => setView("trades")}
            aria-pressed={view === "trades"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === "trades"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
            Trades
          </button>
          <button
            type="button"
            onClick={() => setView("analytics")}
            aria-pressed={view === "analytics"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === "analytics"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
            Analytics
          </button>
        </div>
      )}

      {/* Analytics view (charts) */}
      {!authRequired && loaded && view === "analytics" && trades.length > 0 && (
        <div className="mt-6">
          <AnalyticsPanel trades={filtered} />
        </div>
      )}

      {/* Filter bar - only relevant to the trades table view */}
      {!authRequired && loaded && trades.length > 0 && view === "trades" && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Filter:</span>
          <Select
            value={filter.pair ?? "all"}
            onValueChange={(v) =>
              setFilter((f) => ({ ...f, pair: v === "all" ? null : v }))
            }
          >
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Filter by pair">
              <SelectValue placeholder="All pairs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All pairs</SelectItem>
              {PAIRS.map((p) => (
                <SelectItem key={p} value={p}>
                  {formatPair(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter.direction}
            onValueChange={(v) =>
              setFilter((f) => ({
                ...f,
                direction: v as TradeFilter["direction"],
              }))
            }
          >
            <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="Filter by direction">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sides</SelectItem>
              <SelectItem value="buy">Buys</SelectItem>
              <SelectItem value="sell">Sells</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filter.tag ?? "all"}
            onValueChange={(v) =>
              setFilter((f) => ({ ...f, tag: v === "all" ? null : v }))
            }
          >
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Filter by tag">
              <SelectValue placeholder="All tags" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tags</SelectItem>
              {allTags.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No tags yet
                </SelectItem>
              ) : (
                allTags.map((t) => (
                  <SelectItem key={t} value={t}>
                    #{t}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Select
            value={filter.session}
            onValueChange={(v) =>
              setFilter((f) => ({
                ...f,
                session: v as TradeFilter["session"],
              }))
            }
          >
            <SelectTrigger className="h-8 w-[120px] text-xs" aria-label="Filter by session">
              <SelectValue placeholder="Session" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sessions</SelectItem>
              {SESSIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter.outcome}
            onValueChange={(v) =>
              setFilter((f) => ({
                ...f,
                outcome: v as OutcomeFilter,
              }))
            }
          >
            <SelectTrigger className="h-8 w-[120px] text-xs" aria-label="Filter by outcome">
              <SelectValue placeholder="Outcome" />
            </SelectTrigger>
            <SelectContent>
              {OUTCOME_FILTERS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o === "all"
                    ? "All outcomes"
                    : o[0].toUpperCase() + o.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={
              filter.followedPlan === null
                ? "all"
                : filter.followedPlan
                  ? "yes"
                  : "no"
            }
            onValueChange={(v) =>
              setFilter((f) => ({
                ...f,
                followedPlan:
                  v === "all" ? null : v === "yes" ? true : false,
              }))
            }
          >
            <SelectTrigger className="h-8 w-[120px] text-xs" aria-label="Filter by plan discipline">
              <SelectValue placeholder="Plan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plan</SelectItem>
              <SelectItem value="yes">Followed</SelectItem>
              <SelectItem value="no">Broke</SelectItem>
            </SelectContent>
          </Select>
          {!isFilterEmpty(filter) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setFilter(EMPTY_FILTER)}
            >
              Clear
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            Showing {filtered.length} of {trades.length}
          </span>
        </div>
      )}

      {/* Trades table / empty / loading states */}
      <div className="mt-6">
        {!loaded && !authRequired && (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
            Loading your trades...
          </div>
        )}

        {loaded && !authRequired && trades.length === 0 && (
          <Card className="border-dashed bg-card/50">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <BookOpen className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-lg font-medium">No trades yet</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Log your first trade to start building stats. Each row feeds
                win rate, profit factor and plan-discipline metrics.
              </p>
              <Button className="mt-6" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1">Add your first trade</span>
              </Button>
            </CardContent>
          </Card>
        )}

        {loaded && !authRequired && trades.length > 0 && filtered.length === 0 && (
          <Card className="border-dashed bg-card/50">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No trades match these filters.
            </CardContent>
          </Card>
        )}

        {loaded && !authRequired && filtered.length > 0 && view === "trades" && (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Side</TableHead>
                    <TableHead>Pair</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">SL</TableHead>
                    <TableHead className="text-right">Exit</TableHead>
                    <TableHead className="text-right">Lots</TableHead>
                    <TableHead className="text-right">PnL</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Opened</TableHead>
                    <TableHead className="text-center">Plan</TableHead>
                    <TableHead className="w-[100px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TradeRowItem
                      key={t.id}
                      trade={t}
                      onEdit={() => openEdit(t)}
                      onDelete={() => setDeletingId(t.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit trade" : "Add trade"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? `Update the details of your ${formatPair(editing.pair)} ${editing.direction} trade.`
                : "Log a trade to your journal. PnL auto-suggests from prices and lots."}
            </DialogDescription>
          </DialogHeader>
          <TradeForm
            initial={editing}
            onSaved={handleSaved}
            onCancel={() => {
              setDialogOpen(false);
              setEditing(null);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trade?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the trade from your journal. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Deleting...
                </>
              ) : (
                "Delete trade"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function TradeRowItem({
  trade,
  onEdit,
  onDelete,
}: {
  trade: TradeRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isWin = trade.pnl != null && trade.pnl > 0;
  const isLoss = trade.pnl != null && trade.pnl < 0;

  return (
    <TableRow>
      <TableCell>
        <Badge
          variant="outline"
          className={cn(
            "font-mono",
            trade.direction === "buy"
              ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
              : "border-rose-500/40 text-rose-500 bg-rose-500/10",
          )}
        >
          {trade.direction === "buy" ? "BUY" : "SELL"}
        </Badge>
      </TableCell>
      <TableCell className="font-medium">{formatPair(trade.pair)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {trade.entry_price}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {trade.stop_loss}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {trade.exit_price ?? "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {trade.lot_size.toFixed(2)}
      </TableCell>
      <TableCell
        className={cn(
          "text-right tabular-nums font-medium",
          isWin ? "text-emerald-500" : isLoss ? "text-rose-500" : "text-muted-foreground",
        )}
      >
        {formatMoney(trade.pnl)}
      </TableCell>
      <TableCell>
        {trade.tags && trade.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 max-w-[180px]">
            {trade.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                title={tag}
              >
                <Hash className="h-2.5 w-2.5" aria-hidden="true" />
                {tag}
              </span>
            ))}
            {trade.tags.length > 3 && (
              <span
                className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                title={trade.tags.slice(3).join(", ")}
              >
                +{trade.tags.length - 3}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        <span title={formatDate(trade.opened_at)}>
          {timeAgo(trade.opened_at)}
        </span>
      </TableCell>
      <TableCell className="text-center">
        {trade.followed_plan ? (
          <span
            className="inline-block h-2 w-2 rounded-full bg-emerald-500"
            aria-label="Followed plan"
            title="Followed plan"
          />
        ) : (
          <span
            className="inline-block h-2 w-2 rounded-full bg-amber-500"
            aria-label="Broke plan"
            title="Broke plan"
          />
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onEdit}
            aria-label={`Edit ${formatPair(trade.pair)} trade`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete ${formatPair(trade.pair)} trade`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
