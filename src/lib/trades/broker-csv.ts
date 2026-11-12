/**
 * Broker CSV auto-detection + parsing (Phase 24).
 *
 * Real brokers export trade history in their own CSV formats. This
 * module detects which broker produced a file (from its header
 * columns) and maps the broker's columns to the ForexMind trade
 * schema, then validates each row with tradeCreateSchema.
 *
 * Supported brokers (detection by header signature):
 *  - mt4:   MetaTrader 4 History Center export
 *  - mt5:   MetaTrader 5 deal history export
 *  - oanda: OANDA trade history CSV
 *
 * When no broker is detected, the caller should fall back to the
 * generic parseTradesCsv() which expects ForexMind's own header.
 *
 * All functions are PURE.
 */
import { tradeCreateSchema, type TradeRow } from "@/lib/trades/schema";
import { parseCsv, type CsvParseResult } from "@/lib/trades/csv";
import { normalizePair } from "@/lib/risk";

export type BrokerKind = "mt4" | "mt5" | "oanda";

/**
 * Detect the broker from the CSV header row.
 *
 * Detection is by "signature columns" - columns that are unique to
 * each broker's export. Returns null if no signature matches.
 *
 * Pure. Header columns are matched case-insensitively after trim.
 */
export function detectBroker(headers: string[]): BrokerKind | null {
  const h = headers.map((x) => x.trim().toLowerCase());

  // MT4 signature: "Ticket" + "Open Time" + "Close Time" + "Profit".
  // (MT5 has "Deal" + "Order" but not "Ticket" as the first column.)
  const hasMT4 =
    h.includes("ticket") &&
    h.some((x) => x.includes("open time")) &&
    h.some((x) => x.includes("close time"));

  // MT5 signature: "Deal" + "Order" + "Symbol" + "Type" + "Profit".
  const hasMT5 =
    h.includes("deal") &&
    h.includes("order") &&
    h.includes("symbol") &&
    h.includes("type");

  // OANDA signature: "Trade ID" + "Instrument" + "Units" + "PnL".
  const hasOanda =
    h.some((x) => x.includes("trade id")) &&
    h.some((x) => x.includes("instrument")) &&
    h.includes("units") &&
    h.some((x) => x.startsWith("pnl"));

  if (hasMT4) return "mt4";
  if (hasMT5) return "mt5";
  if (hasOanda) return "oanda";
  return null;
}

/**
 * One broker's column map. Each entry maps a broker column name (lowercased)
 * to a function that converts the raw CSV string into the value our
 * tradeCreateSchema expects.
 */
type BrokerMap = Record<string, (raw: string) => unknown>;

/** Parse "2026.01.15 08:30:00" (broker format) into ISO 8601. */
function brokerDateToIso(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  // Replace dots with dashes in the date part.
  const m = trimmed.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/);
  if (m) {
    const [, y, mo, d, time] = m;
    const t = time!.includes(":") && time!.split(":").length === 2 ? `${time}:00` : time;
    return `${y}-${mo}-${d}T${t}Z`;
  }
  // Already ISO or date-only - pass through (parseTradesCsv's normalizeDate
  // handles those, but we're building the trade object directly here).
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00Z`;
  return trimmed;
}

/** Parse a number, treating empty / "-" as undefined. */
function numOrUndef(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-") return undefined;
  // Strip thousands separators (space, comma).
  const cleaned = trimmed.replace(/[\s,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** MT4 "Type" column -> "buy" | "sell". */
function mt4Direction(raw: string): "buy" | "sell" | undefined {
  const lower = raw.trim().toLowerCase();
  if (lower.includes("buy")) return "buy";
  if (lower.includes("sell")) return "sell";
  return undefined;
}

/** OANDA "Units" -> lot_size (units / 100000) + direction sign. */
function oandaUnitsToLot(raw: string): { lot: number; direction: "buy" | "sell" } | undefined {
  const n = numOrUndef(raw);
  if (n == null) return undefined;
  const lot = Math.abs(n) / 100_000;
  return { lot, direction: n >= 0 ? "buy" : "sell" };
}

const BROKER_MAPS: Record<BrokerKind, BrokerMap> = {
  mt4: {
    symbol: (raw) => normalizePair(raw.trim()),
    type: mt4Direction,
    volume: (raw) => numOrUndef(raw),
    "open price": (raw) => numOrUndef(raw),
    "close price": (raw) => numOrUndef(raw),
    sl: (raw) => numOrUndef(raw),
    tp: (raw) => numOrUndef(raw),
    "open time": (raw) => brokerDateToIso(raw),
    "close time": (raw) => brokerDateToIso(raw),
    profit: (raw) => numOrUndef(raw),
    comment: (raw) => raw.trim(),
  },
  mt5: {
    symbol: (raw) => normalizePair(raw.trim()),
    type: mt4Direction, // same buy/sell convention
    volume: (raw) => numOrUndef(raw),
    price: (raw) => numOrUndef(raw), // entry (deal open price)
    sl: (raw) => numOrUndef(raw),
    tp: (raw) => numOrUndef(raw),
    time: (raw) => brokerDateToIso(raw),
    profit: (raw) => numOrUndef(raw),
    comment: (raw) => raw.trim(),
  },
  oanda: {
    instrument: (raw) => normalizePair(raw.trim()),
    units: (raw) => oandaUnitsToLot(raw), // special: returns {lot, direction}
    price: (raw) => numOrUndef(raw), // entry
    "price.1": (raw) => numOrUndef(raw), // exit
    open: (raw) => brokerDateToIso(raw),
    close: (raw) => brokerDateToIso(raw),
    "pnl (usd)": (raw) => numOrUndef(raw),
  },
};

/**
 * Parse a broker CSV string into trades + errors.
 *
 *  1. Detect the broker from the header.
 *  2. For each data row, map broker columns to trade fields using
 *     BROKER_MAPS[broker].
 *  3. Validate with tradeCreateSchema.
 *  4. Return the same CsvParseResult shape as parseTradesCsv().
 *
 * If detection fails, returns an error result (the caller should fall
 * back to parseTradesCsv).
 *
 * Pure.
 */
export function parseBrokerCsv(text: string): CsvParseResult {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { valid: [], errors: [{ row: 0, error: "CSV is empty." }], total: 0 };
  }

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const broker = detectBroker(rows[0]!.map((h) => h.trim()));
  if (!broker) {
    return {
      valid: [],
      errors: [{ row: 0, error: "Could not detect broker format from header." }],
      total: 0,
    };
  }

  const map = BROKER_MAPS[broker];
  const colMap = new Map<string, number>();
  for (let i = 0; i < header.length; i++) {
    colMap.set(header[i]!, i);
  }

  const valid: CsvParseResult["valid"] = [];
  const errors: CsvParseResult["errors"] = [];
  const dataRows = rows.slice(1);
  let count = 0;

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx]!;
    const rowNum = rowIdx + 2;
    count++;

    const trade: Record<string, unknown> = {};
    // Special handling for OANDA units (carries direction + lot).
    let oandaDir: "buy" | "sell" | undefined;

    for (const [brokerCol, transform] of Object.entries(map)) {
      const idx = colMap.get(brokerCol);
      if (idx == null) continue;
      const raw = row[idx] ?? "";
      const value = transform(raw);

      // OANDA units -> special.
      if (broker === "oanda" && brokerCol === "units") {
        const u = value as ReturnType<typeof oandaUnitsToLot>;
        if (u) {
          trade.lot_size = u.lot;
          oandaDir = u.direction;
        }
        continue;
      }

      // Map broker column -> our field.
      const field = brokerFieldMap[broker]![brokerCol];
      if (field && value !== undefined) {
        trade[field] = value;
      }
    }

    // OANDA: set direction from units sign.
    if (broker === "oanda" && oandaDir) {
      trade.direction = oandaDir;
    }

    // Skip blank rows.
    if (
      trade.pair == null &&
      trade.direction == null &&
      trade.entry_price == null
    ) {
      continue;
    }

    // Broker exports (especially OANDA) often omit SL/TP. Our schema
    // requires stop_loss, so default a missing SL to the entry price
    // (0-pip risk). The trade will show as "0 pips risk" in the
    // journal - a clear signal to the user to edit it. take_profit is
    // already nullable, so leave it absent when not provided.
    if (trade.stop_loss == null && typeof trade.entry_price === "number") {
      trade.stop_loss = trade.entry_price;
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

/**
 * Map from broker column name -> our trade schema field.
 * (BROKER_MAPS above holds the transforms; this holds the destination.)
 */
const brokerFieldMap: Record<BrokerKind, Record<string, string>> = {
  mt4: {
    symbol: "pair",
    type: "direction",
    volume: "lot_size",
    "open price": "entry_price",
    "close price": "exit_price",
    sl: "stop_loss",
    tp: "take_profit",
    "open time": "opened_at",
    "close time": "closed_at",
    profit: "pnl",
    comment: "notes",
  },
  mt5: {
    symbol: "pair",
    type: "direction",
    volume: "lot_size",
    price: "entry_price",
    sl: "stop_loss",
    tp: "take_profit",
    time: "opened_at",
    profit: "pnl",
    comment: "notes",
  },
  oanda: {
    instrument: "pair",
    price: "entry_price",
    "price.1": "exit_price",
    open: "opened_at",
    close: "closed_at",
    "pnl (usd)": "pnl",
  },
};
