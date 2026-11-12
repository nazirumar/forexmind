"use client";

/**
 * Import/Export panel for the trade journal.
 *
 * Export:
 *  - "Export CSV" button → GET /api/trades/export → downloads
 *    forexmind-trades-YYYY-MM-DD.csv with all the user's trades.
 *
 * Import:
 *  - File picker accepts .csv files.
 *  - On file select, read the file as text, POST to /api/trades/import.
 *  - Show a result panel: "Imported N trades" + any row-level errors
 *    with row numbers + error messages so the user can fix their CSV.
 *  - "Download template" button → downloads a CSV with the header row
 *    + one example row, so the user knows the expected format.
 *
 *  - "Import" parses the CSV client-side first (using the pure
 *    parseTradesCsv function) to show a preview, THEN sends to the
 *    server. This gives instant feedback before the network round-trip.
 */
import { useState, useRef } from "react";
import { Download, Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildCsvTemplate, exportFilename, parseTradesCsv } from "@/lib/trades/csv";
import { cn } from "@/lib/utils";

type ImportResult = {
  imported: number;
  errors: Array<{ row: number; error: string }>;
  total: number;
};

type PreviewResult = {
  validCount: number;
  errors: Array<{ row: number; error: string }>;
  total: number;
};

export function ImportExportPanel({ onImported }: { onImported?: () => void }) {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/trades/export");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Sign in to export your trades.");
        } else {
          setError(body?.error ?? `Failed (HTTP ${res.status})`);
        }
        return;
      }
      // Trigger download.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error - please try again.",
      );
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);
    setPreview(null);

    // Read the file as text.
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("Failed to read the file.");
      return;
    }

    // Preview: parse client-side to show counts + errors before
    // sending to the server.
    const previewResult = parseTradesCsv(text);
    setPreview({
      validCount: previewResult.valid.length,
      errors: previewResult.errors,
      total: previewResult.total,
    });

    if (previewResult.valid.length === 0) {
      // Don't send to the server if there's nothing valid.
      return;
    }

    // Send to the server for actual import.
    setImporting(true);
    try {
      const res = await fetch("/api/trades/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Sign in to import trades.");
        } else {
          setError(body?.error ?? `Failed (HTTP ${res.status})`);
          // Server returned errors - use those instead of our preview.
          if (body?.errors) {
            setResult({
              imported: 0,
              errors: body.errors,
              total: body.total ?? previewResult.total,
            });
          }
        }
        return;
      }
      const data: ImportResult = await res.json();
      setResult(data);
      onImported?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error - please try again.",
      );
    } finally {
      setImporting(false);
      // Reset the file input so the same file can be selected again.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownloadTemplate = () => {
    const template = buildCsvTemplate();
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "forexmind-trades-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="bg-card/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Import / Export</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Back up your journal as CSV, or import trades from a spreadsheet.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="ml-1">Export CSV</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="ml-1">Import CSV</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownloadTemplate}
            className="text-xs"
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            <span className="ml-1">Template</span>
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileSelect}
            className="hidden"
            aria-label="Choose CSV file"
          />
        </div>

        {/* Preview (before server round-trip) */}
        {preview && !result && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">Preview:</span>
              <Badge variant="secondary" className="text-[10px] py-0">
                {preview.validCount} valid
              </Badge>
              {preview.errors.length > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] py-0 border-amber-500/40 text-amber-500"
                >
                  {preview.errors.length} errors
                </Badge>
              )}
              <span className="text-muted-foreground">
                of {preview.total} rows
              </span>
            </div>
            {preview.validCount === 0 ? (
              <p className="text-amber-500">
                No valid rows found. Fix the errors below and re-upload.
              </p>
            ) : (
              <p className="text-muted-foreground">
                {importing
                  ? "Importing to your journal..."
                  : "Looks good - the import is being sent to the server."}
              </p>
            )}
          </div>
        )}

        {/* Import result */}
        {result && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-2">
            <div className="flex items-center gap-2">
              {result.imported > 0 ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
              )}
              <span className="font-medium">
                {result.imported > 0
                  ? `Imported ${result.imported} trade${result.imported === 1 ? "" : "s"} successfully.`
                  : "No trades imported."}
              </span>
            </div>

            {result.errors.length > 0 && (
              <div>
                <p className="text-muted-foreground mb-1">
                  {result.errors.length} row{result.errors.length === 1 ? "" : "s"} had errors:
                </p>
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.slice(0, 10).map((err, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Badge
                        variant="outline"
                        className="text-[10px] py-0 font-mono shrink-0"
                      >
                        row {err.row}
                      </Badge>
                      <span className="text-muted-foreground">{err.error}</span>
                    </li>
                  ))}
                  {result.errors.length > 10 && (
                    <li className="text-muted-foreground italic">
                      ...and {result.errors.length - 10} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Format help */}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            CSV format help
          </summary>
          <div className="mt-2 space-y-1 text-muted-foreground">
            <p>Required columns: <code>pair, direction, entry_price, stop_loss, lot_size, opened_at</code></p>
            <p>Optional columns: <code>exit_price, take_profit, closed_at, pnl, strategy, session, emotion, followed_plan, notes</code></p>
            <p>Direction: <code>buy</code> or <code>sell</code>. Session: <code>asian, london, newyork, overlap</code>.</p>
            <p>Dates: ISO 8601 (<code>2026-01-15T08:30:00Z</code>) or <code>2026-01-15</code> or <code>2026-01-15 08:30:00</code>.</p>
            <p>followed_plan: <code>true/false</code> or <code>1/0</code> or <code>yes/no</code>.</p>
            <p>Click <strong>Template</strong> to download a CSV with the header + an example row.</p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
