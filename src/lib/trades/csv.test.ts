/**
 * Tests for the pure CSV functions in src/lib/trades/csv.ts.
 *
 * Covers:
 *  - parseCsv: RFC 4180 compliance (quoted fields, escaped quotes, embedded newlines)
 *  - parseTradesCsv: header parsing, type coercion, date normalization, validation errors
 *  - tradesToCsv: round-trip (parse(export(trades)) == trades)
 *  - buildCsvTemplate: header + example row
 */
import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseTradesCsv,
  tradesToCsv,
  buildCsvTemplate,
  exportFilename,
} from "@/lib/trades/csv";
import type { TradeRow } from "@/lib/trades/schema";

function makeRow(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: crypto.randomUUID(),
    user_id: crypto.randomUUID(),
    pair: "EURUSD",
    direction: "buy",
    entry_price: 1.085,
    exit_price: 1.09,
    stop_loss: 1.08,
    take_profit: 1.1,
    lot_size: 0.5,
    opened_at: "2026-01-15T08:30:00Z",
    closed_at: "2026-01-15T12:00:00Z",
    pnl: 30,
    strategy: "trend",
    session: "london",
    emotion: "calm",
    followed_plan: true,
    notes: "test note",
    created_at: "2026-01-15T08:30:00Z",
    tags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

describe("parseCsv", () => {
  it("parses a simple CSV with header + rows", () => {
    const csv = "a,b,c\n1,2,3\n4,5,6";
    expect(parseCsv(csv)).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    const csv = 'name,note\n"test","hello, world"';
    expect(parseCsv(csv)).toEqual([
      ["name", "note"],
      ["test", "hello, world"],
    ]);
  });

  it("handles escaped quotes (double-quote escaping)", () => {
    const csv = 'name,note\n"test","she said ""hi"""';
    expect(parseCsv(csv)).toEqual([
      ["name", "note"],
      ["test", 'she said "hi"'],
    ]);
  });

  it("handles embedded newlines in quoted fields", () => {
    const csv = 'name,note\n"test","line1\nline2"';
    expect(parseCsv(csv)).toEqual([
      ["name", "note"],
      ["test", "line1\nline2"],
    ]);
  });

  it("normalizes \\r\\n and \\r to \\n", () => {
    const csv = "a,b\r\n1,2\r3,4";
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("skips completely empty rows", () => {
    const csv = "a,b\n1,2\n\n\n3,4";
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("handles a single header row with no data", () => {
    expect(parseCsv("a,b,c")).toEqual([["a", "b", "c"]]);
  });
});

// ---------------------------------------------------------------------------
// parseTradesCsv
// ---------------------------------------------------------------------------

describe("parseTradesCsv", () => {
  const header = "pair,direction,entry_price,exit_price,stop_loss,take_profit,lot_size,opened_at,closed_at,pnl,strategy,session,emotion,followed_plan,notes";

  it("parses a valid CSV row into a trade", () => {
    const csv = `${header}\nEURUSD,buy,1.0850,1.0910,1.0820,1.1000,0.50,2026-01-15T08:30:00Z,2026-01-15T12:00:00Z,30.00,trend,london,calm,true,"Good setup"`;
    const result = parseTradesCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]!.pair).toBe("EURUSD");
    expect(result.valid[0]!.direction).toBe("buy");
    expect(result.valid[0]!.entry_price).toBe(1.085);
    expect(result.valid[0]!.pnl).toBe(30);
    expect(result.valid[0]!.followed_plan).toBe(true);
    expect(result.valid[0]!.notes).toBe("Good setup");
  });

  it("treats empty optional fields as null/undefined", () => {
    const csv = `${header}\nEURUSD,buy,1.0850,,1.0820,,0.50,2026-01-15T08:30:00Z,,,trend,,,true,""`;
    const result = parseTradesCsv(csv);
    expect(result.errors).toEqual([]);
    // exit_price/take_profit/pnl are .optional().nullable() with no
    // .transform() - empty input becomes undefined (absent from output).
    expect(result.valid[0]!.exit_price).toBeUndefined();
    expect(result.valid[0]!.take_profit).toBeUndefined();
    expect(result.valid[0]!.pnl).toBeUndefined();
    // closed_at/emotion/notes have a .transform() that converts "" to
    // null - but since normalizeField returns undefined for "", the
    // transform doesn't run... actually it does run because the key
    // exists with value undefined in the input object. Zod's behavior
    // here is: .optional().nullable().transform() with undefined input
    // runs the transform, which converts undefined to null via the
    // `s == null` check (null == undefined is true in JS).
    expect(result.valid[0]!.closed_at).toBeNull();
    expect(result.valid[0]!.emotion).toBeNull();
    expect(result.valid[0]!.notes).toBeNull();
    // session is .enum().optional().nullable() - empty becomes undefined.
    expect(result.valid[0]!.session).toBeUndefined();
  });

  it("normalizes date-only format to ISO with 00:00:00Z", () => {
    const csv = `${header}\nEURUSD,buy,1.0850,1.0900,1.0820,1.1000,0.50,2026-01-15,,30.00,,,calm,true,""`;
    const result = parseTradesCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid[0]!.opened_at).toBe("2026-01-15T00:00:00Z");
  });

  it("normalizes space-separated datetime to ISO", () => {
    const csv = `${header}\nEURUSD,buy,1.0850,1.0900,1.0820,1.1000,0.50,2026-01-15 08:30:00,2026-01-15 12:00:00,30.00,,,calm,true,""`;
    const result = parseTradesCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid[0]!.opened_at).toBe("2026-01-15T08:30:00Z");
    expect(result.valid[0]!.closed_at).toBe("2026-01-15T12:00:00Z");
  });

  it("accepts followed_plan as 1/0/yes/no", () => {
    const csv = `${header}\nEURUSD,buy,1.0850,1.0900,1.0820,1.1000,0.50,2026-01-15T08:30:00Z,,30.00,trend,london,calm,1,""\nEURUSD,sell,1.0850,1.0800,1.0900,1.0700,0.50,2026-01-16T08:30:00Z,,-20.00,trend,london,FOMO,no,""`;
    const result = parseTradesCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid[0]!.followed_plan).toBe(true);
    expect(result.valid[1]!.followed_plan).toBe(false);
  });

  it("normalizes pair case (eur/usd -> EURUSD)", () => {
    const csv = `${header}\neur/usd,buy,1.0850,1.0900,1.0820,1.1000,0.50,2026-01-15T08:30:00Z,,30.00,trend,london,calm,true,""`;
    const result = parseTradesCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid[0]!.pair).toBe("EURUSD");
  });

  it("collects errors with row numbers for invalid rows", () => {
    const csv = `${header}\nEURUSD,buy,1.0850,1.0900,1.0820,1.1000,0.50,2026-01-15T08:30:00Z,,30.00,trend,london,calm,true,""\nBADPAIR,buy,1.0850,1.0900,1.0820,1.1000,0.50,2026-01-15T08:30:00Z,,30.00,trend,london,calm,true,""\nEURUSD,long,1.0850,1.0900,1.0820,1.1000,0.50,2026-01-15T08:30:00Z,,30.00,trend,london,calm,true,""`;
    const result = parseTradesCsv(csv);
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.row).toBe(3); // row 3 = second data row
    expect(result.errors[1]!.row).toBe(4);
    expect(result.total).toBe(3);
  });

  it("rejects missing required columns", () => {
    const csv = "pair,direction,entry_price\nEURUSD,buy,1.0850";
    const result = parseTradesCsv(csv);
    expect(result.valid).toEqual([]);
    expect(result.errors[0]!.error).toMatch(/Missing required columns/);
    expect(result.errors[0]!.error).toMatch(/stop_loss/);
  });

  it("rejects empty CSV", () => {
    const result = parseTradesCsv("");
    expect(result.valid).toEqual([]);
    expect(result.errors[0]!.error).toBe("CSV is empty.");
  });

  it("handles case-insensitive headers", () => {
    const csv = "PAIR,Direction,ENTRY_PRICE,EXIT_PRICE,STOP_LOSS,TAKE_PROFIT,LOT_SIZE,OPENED_AT,CLOSED_AT,PNL,STRATEGY,SESSION,EMOTION,FOLLOWED_PLAN,NOTES\nEURUSD,buy,1.0850,1.0900,1.0820,1.1000,0.50,2026-01-15T08:30:00Z,,30.00,trend,london,calm,true,\"\"";
    const result = parseTradesCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid).toHaveLength(1);
  });

  it("handles quoted notes with embedded commas and newlines", () => {
    const csv = `${header}\nEURUSD,buy,1.0850,1.0900,1.0820,1.1000,0.50,2026-01-15T08:30:00Z,,30.00,trend,london,calm,true,"Waited for breakout.\nEntry above 1.0845,\nSL below 1.0820"`;
    const result = parseTradesCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid[0]!.notes).toBe("Waited for breakout.\nEntry above 1.0845,\nSL below 1.0820");
  });
});

// ---------------------------------------------------------------------------
// tradesToCsv (round-trip)
// ---------------------------------------------------------------------------

describe("tradesToCsv", () => {
  it("produces a CSV with the header row + one row per trade", () => {
    const trades = [makeRow(), makeRow({ pair: "GBPUSD" })];
    const csv = tradesToCsv(trades);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 trades
    expect(lines[0]).toContain("pair");
    expect(lines[0]).toContain("direction");
  });

  it("quotes all fields", () => {
    const trades = [makeRow()];
    const csv = tradesToCsv(trades);
    // The header row is unquoted (just column names), but data rows
    // have every field quoted.
    const dataLine = csv.trim().split("\n")[1]!;
    // Should start with a quote (the pair field).
    expect(dataLine.startsWith('"')).toBe(true);
  });

  it("escapes embedded quotes in notes", () => {
    const trades = [makeRow({ notes: 'She said "hi"' })];
    const csv = tradesToCsv(trades);
    expect(csv).toContain('""hi""');
  });

  it("renders null fields as empty quoted strings", () => {
    const trades = [makeRow({ exit_price: null, closed_at: null, pnl: null, notes: null })];
    const csv = tradesToCsv(trades);
    const dataLine = csv.trim().split("\n")[1]!;
    expect(dataLine).toContain('""');
  });

  it("round-trips: parse(export(trades)) reproduces the trades", () => {
    const original = [
      makeRow({ pair: "EURUSD", direction: "buy", notes: "Test note" }),
      makeRow({ pair: "USDJPY", direction: "sell", notes: "Another note" }),
    ];
    const csv = tradesToCsv(original);
    const result = parseTradesCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid).toHaveLength(2);
    expect(result.valid[0]!.pair).toBe("EURUSD");
    expect(result.valid[0]!.direction).toBe("buy");
    expect(result.valid[0]!.notes).toBe("Test note");
    expect(result.valid[1]!.pair).toBe("USDJPY");
    expect(result.valid[1]!.direction).toBe("sell");
  });
});

// ---------------------------------------------------------------------------
// buildCsvTemplate
// ---------------------------------------------------------------------------

describe("buildCsvTemplate", () => {
  it("returns a CSV with header + one example row", () => {
    const template = buildCsvTemplate();
    const lines = template.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("pair");
    expect(lines[0]).toContain("direction");
    expect(lines[1]).toContain("EURUSD");
    expect(lines[1]).toContain("buy");
  });
});

// ---------------------------------------------------------------------------
// exportFilename
// ---------------------------------------------------------------------------

describe("exportFilename", () => {
  it("returns a filename in the format forexmind-trades-YYYY-MM-DD.csv", () => {
    const name = exportFilename();
    expect(name).toMatch(/^forexmind-trades-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
