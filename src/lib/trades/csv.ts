/**
 * CSV import/export for the trade journal.
 *
 * All functions here are PURE: take strings in, return trades/strings
 * out. No I/O. This makes them trivial to unit-test and safe to call
 * from both server and client code.
 *
 * CSV format (RFC 4180):
 *  - Header row required: pair,direction,entry_price,exit_price,stop_loss,
 *    take_profit,lot_size,opened_at,closed_at,pnl,strategy,session,
 *    emotion,followed_plan,notes
 *  - Comma-separated, double-quote-enclosed fields with embedded
 *    commas/newlines/quotes (escaped as "")
 *  - UTF-8
 *  - Newlines: \n (we normalize \r\n on import)
 *
 * Date format: ISO 8601 (e.g. "2026-01-15T08:30:00Z"). We also accept
 * "2026-01-15 08:30:00" and "2026-01-15" (date-only, time defaults to
 * 00:00:00 UTC) for flexibility with spreadsheet exports.
 */
import { tradeCreateSchema, type TradeRow } from "@/lib/trades/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A trade row as parsed from CSV (before zod validation). */
type CsvTrade = Record<string, string>;

/** Result of parsing a CSV string into trades. */
export type CsvParseResult = {
  /** Trades that parsed + zod-validated successfully. */
  valid: ReturnType<typeof tradeCreateSchema.parse>[];
  /** Rows that failed validation, with the row number + error. */
  errors: Array<{ row: number; error: string }>;
  /** Total number of data rows (excluding header). */
  total: number;
};

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180)
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string into rows of string fields.
 *
 *  - First line is the header.
 *  - Fields are comma-separated.
 *  - Double-quoted fields can contain commas, newlines, and escaped
 *    quotes ("").
 *  - \r\n and \r are normalized to \n.
 *  - Empty lines (after trimming) are skipped.
 *
 * Pure. Returns [header, ...rows].
 */
export function parseCsv(text: string): string[][] {
  // Normalize newlines.
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ("")
        if (normalized[i + 1] === '"') {
          field += '"';
          i++; // skip the next quote
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        current.push(field);
        field = "";
      } else if (char === "\n") {
        current.push(field);
        rows.push(current);
        current = [];
        field = "";
      } else {
        field += char;
      }
    }
  }

  // Last field + row (if there's no trailing newline)
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  // Filter out completely empty rows (just whitespace)
  return rows.filter((r) => r.some((f) => f.trim().length > 0));
}

// ---------------------------------------------------------------------------
// CSV → trades
// ---------------------------------------------------------------------------

/** Expected CSV header columns (lowercase, case-insensitive on import). */
const EXPECTED_COLUMNS = [
  "pair",
  "direction",
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "lot_size",
  "opened_at",
  "closed_at",
  "pnl",
  "strategy",
  "session",
  "emotion",
  "followed_plan",
  "notes",
  "tags",
] as const;

/**
 * Tag separator used inside a CSV cell.
 *
 * CSV cells can't contain a bare comma (it would split the column),
 * so tags within a single cell are joined with a pipe. We accept pipe
 * or semicolon on import for tolerance. The cell is always quoted on
 * export, so embedded pipes are safe.
 */
const CSV_TAG_SEPARATOR = "|";

/**
 * Parse a CSV string into a list of trades + errors.
 *
 *  - The first row must be the header (case-insensitive column match).
 *  - Empty optional fields (exit_price, take_profit, closed_at, pnl,
 *    strategy, session, emotion, notes) are treated as null.
 *  - followed_plan accepts "true"/"false"/"1"/"0"/"yes"/"no" (case-insensitive).
 *  - Each row is validated with tradeCreateSchema; failures are collected
 *    with the row number + error message so the UI can show them.
 *
 * Pure.
 */
export function parseTradesCsv(text: string): CsvParseResult {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { valid: [], errors: [{ row: 0, error: "CSV is empty." }], total: 0 };
  }

  // Build a header map: lowercase column name -> index.
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const colMap = new Map<string, number>();
  for (let i = 0; i < header.length; i++) {
    colMap.set(header[i]!, i);
  }

  // Check that required columns exist.
  const required = ["pair", "direction", "entry_price", "stop_loss", "lot_size", "opened_at"];
  const missing = required.filter((c) => !colMap.has(c));
  if (missing.length > 0) {
    return {
      valid: [],
      errors: [{ row: 0, error: `Missing required columns: ${missing.join(", ")}` }],
      total: 0,
    };
  }

  const valid: CsvParseResult["valid"] = [];
  const errors: CsvParseResult["errors"] = [];
  const dataRows = rows.slice(1);
  let count = 0;

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx]!;
    const rowNum = rowIdx + 2; // +1 for 1-indexed, +1 for header
    count++;

    // Build the trade object from the row using the header map.
    const trade: Record<string, unknown> = {};
    for (const col of EXPECTED_COLUMNS) {
      const idx = colMap.get(col);
      if (idx == null) continue;
      const raw = row[idx]?.trim() ?? "";
      trade[col] = normalizeField(col, raw);
    }

    const parsed = tradeCreateSchema.safeParse(trade);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      errors.push({ row: rowNum, error: msg });
    }
  }

  return { valid, errors, total: count };
}

/** Normalize a CSV string field into the type zod expects. */
function normalizeField(col: string, raw: string): unknown {
  if (raw === "") return undefined;

  switch (col) {
    case "entry_price":
    case "exit_price":
    case "stop_loss":
    case "take_profit":
    case "lot_size":
    case "pnl": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "direction":
      return raw.toLowerCase();
    case "session":
      return raw.toLowerCase();
    case "followed_plan": {
      const lower = raw.toLowerCase();
      if (["true", "1", "yes", "y"].includes(lower)) return true;
      if (["false", "0", "no", "n"].includes(lower)) return false;
      return undefined;
    }
    case "opened_at":
    case "closed_at":
      return normalizeDate(raw);
    case "strategy":
    case "emotion":
    case "notes":
      return raw;
    case "tags":
      // Pass the raw string through; tradeCreateSchema's `tags` field
      // accepts a string and runs normalizeTags on it (splitting on
      // pipe / semicolon / comma / whitespace). Returning undefined
      // for an empty cell keeps the create schema's default ([]) intact.
      return raw === "" ? undefined : raw;
    default:
      return raw;
  }
}

/**
 * Normalize a date string from CSV into ISO 8601.
 *
 * Accepts:
 *  - "2026-01-15T08:30:00Z" (already ISO)
 *  - "2026-01-15 08:30:00" (space-separated)
 *  - "2026-01-15" (date-only, time defaults to 00:00:00)
 *  - "2026/01/15" (slash-separated)
 *
 * Returns the original string if it can't be parsed (zod will reject it).
 */
function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  // Replace slashes with dashes
  const normalized = trimmed.replace(/\//g, "-");
  // If date-only, append T00:00:00Z
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return `${normalized}T00:00:00Z`;
  }
  // If "YYYY-MM-DD HH:MM:SS", replace space with T
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    return normalized.replace(" ", "T").replace(/$/, (m) =>
      /\d{2}:\d{2}:\d{2}$/.test(normalized) ? "" : ":00",
    ) + "Z";
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Trades → CSV
// ---------------------------------------------------------------------------

/**
 * Convert a list of trades into a CSV string.
 *
 *  - Includes the header row.
 *  - All fields are quoted (simplest escaping).
 *  - Null fields are empty strings.
 *  - Dates are ISO 8601.
 *
 * Pure.
 */
export function tradesToCsv(trades: TradeRow[]): string {
  const header = EXPECTED_COLUMNS.join(",");
  const lines = [header];

  for (const t of trades) {
    const fields = EXPECTED_COLUMNS.map((col) => {
      const val = (t as unknown as Record<string, unknown>)[col];
      return formatCsvField(val);
    });
    lines.push(fields.join(","));
  }

  return lines.join("\n") + "\n";
}

/** Format a single field for CSV output (always quoted). */
function formatCsvField(val: unknown): string {
  if (val == null) return '""';
  if (Array.isArray(val)) {
    // Tags column: join with the CSV tag separator (pipe). Each
    // element is escaped like a normal string field, then we re-quote
    // the whole joined value.
    if (val.length === 0) return '""';
    const joined = val.map((v) => String(v).replace(/"/g, '""')).join(CSV_TAG_SEPARATOR);
    return `"${joined}"`;
  }
  if (typeof val === "boolean") return val ? '"true"' : '"false"';
  if (typeof val === "number") {
    // Use full precision; CSV consumers (Excel, Sheets) handle it.
    return `"${String(val)}"`;
  }
  // String: escape embedded quotes by doubling them
  const escaped = String(val).replace(/"/g, '""');
  return `"${escaped}"`;
}

// ---------------------------------------------------------------------------
// CSV template (for the user to download and fill in)
// ---------------------------------------------------------------------------

/**
 * Build a CSV template with the header row + one example row.
 * Used by the "Download template" button in the import panel.
 */
export function buildCsvTemplate(): string {
  const example = [
    "EURUSD",
    "buy",
    "1.0850",
    "1.0910",
    "1.0820",
    "1.1000",
    "0.50",
    "2026-01-15T08:30:00Z",
    "2026-01-15T12:00:00Z",
    "30.00",
    "trend-follow",
    "london",
    "calm",
    "true",
    "Waited for London open breakout above 1.0845",
    "breakout|london-open",
  ];
  const header = EXPECTED_COLUMNS.join(",");
  const exampleLine = example.map((f) => `"${f}"`).join(",");
  return `${header}\n${exampleLine}\n`;
}

// ---------------------------------------------------------------------------
// Filename helper
// ---------------------------------------------------------------------------

/** Build a sensible export filename: forexmind-trades-YYYY-MM-DD.csv */
export function exportFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `forexmind-trades-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}
