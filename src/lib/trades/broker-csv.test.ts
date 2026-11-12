/**
 * Tests for broker CSV auto-detection + parsing (Phase 24).
 */
import { describe, it, expect } from "vitest";
import { detectBroker, parseBrokerCsv } from "@/lib/trades/broker-csv";

describe("detectBroker", () => {
  it("detects MT4 from its header signature", () => {
    const headers = [
      "Ticket",
      "Open Time",
      "Type",
      "Volume",
      "Symbol",
      "Open Price",
      "SL",
      "TP",
      "Close Time",
      "Close Price",
      "Profit",
    ];
    expect(detectBroker(headers)).toBe("mt4");
  });

  it("detects MT5 from its header signature", () => {
    const headers = [
      "Time",
      "Deal",
      "Symbol",
      "Type",
      "Direction",
      "Volume",
      "Price",
      "Order",
      "Commission",
      "Fee",
      "Swap",
      "Profit",
      "Balance",
      "Comment",
    ];
    expect(detectBroker(headers)).toBe("mt5");
  });

  it("detects OANDA from its header signature", () => {
    const headers = [
      "Trade ID",
      "Instrument",
      "Open",
      "Close",
      "Units",
      "Price",
      "Price.1",
      "PnL (USD)",
      "Duration",
    ];
    expect(detectBroker(headers)).toBe("oanda");
  });

  it("returns null for an unrecognized header (generic ForexMind format)", () => {
    const headers = [
      "pair",
      "direction",
      "entry_price",
      "exit_price",
      "stop_loss",
    ];
    expect(detectBroker(headers)).toBeNull();
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(detectBroker(["  TICKET ", " Open Time ", "Close Time"])).toBe("mt4");
    expect(detectBroker(["DEAL", "ORDER", "SYMBOL", "TYPE"])).toBe("mt5");
  });
});

describe("parseBrokerCsv", () => {
  it("parses an MT4 export into valid trades", () => {
    const csv = [
      "Ticket,Open Time,Type,Volume,Symbol,Open Price,SL,TP,Close Time,Close Price,Profit",
      "1,2026.01.15 08:30:00,buy,0.5,EURUSD,1.0850,1.0800,1.0950,2026.01.15 12:00:00,1.0900,250.00",
      "2,2026.01.16 10:00:00,sell,0.3,GBPUSD,1.2800,1.2850,1.2700,2026.01.16 14:00:00,1.2750,150.00",
    ].join("\n");
    const result = parseBrokerCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid).toHaveLength(2);
    expect(result.valid[0]!.pair).toBe("EURUSD");
    expect(result.valid[0]!.direction).toBe("buy");
    expect(result.valid[0]!.entry_price).toBe(1.085);
    expect(result.valid[0]!.stop_loss).toBe(1.08);
    expect(result.valid[0]!.take_profit).toBe(1.095);
    expect(result.valid[0]!.lot_size).toBe(0.5);
    expect(result.valid[0]!.opened_at).toBe("2026-01-15T08:30:00Z");
    expect(result.valid[0]!.closed_at).toBe("2026-01-15T12:00:00Z");
    expect(result.valid[0]!.pnl).toBe(250);
    expect(result.valid[1]!.pair).toBe("GBPUSD");
    expect(result.valid[1]!.direction).toBe("sell");
  });

  it("parses an OANDA export, deriving direction from units sign", () => {
    const csv = [
      "Trade ID,Instrument,Open,Close,Units,Price,Price.1,PnL (USD),Duration",
      "1,EURUSD,2026.01.15 08:30:00,2026.01.15 12:00:00,50000,1.0850,1.0900,250.00,3.5h",
      "2,GBPUSD,2026.01.16 10:00:00,2026.01.16 14:00:00,-30000,1.2800,1.2750,150.00,4h",
    ].join("\n");
    const result = parseBrokerCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid).toHaveLength(2);
    // 50000 units = 0.5 lot, buy.
    expect(result.valid[0]!.lot_size).toBe(0.5);
    expect(result.valid[0]!.direction).toBe("buy");
    // -30000 units = 0.3 lot, sell.
    expect(result.valid[1]!.lot_size).toBe(0.3);
    expect(result.valid[1]!.direction).toBe("sell");
  });

  it("parses an MT5 export", () => {
    const csv = [
      "Time,Deal,Symbol,Type,Direction,Volume,Price,Order,Commission,Fee,Swap,Profit,Balance,Comment",
      "2026.01.15 08:30:00,1,EURUSD,buy,in,0.5,1.0850,100,0,0,0,250.00,10250,London breakout",
    ].join("\n");
    const result = parseBrokerCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]!.pair).toBe("EURUSD");
    expect(result.valid[0]!.direction).toBe("buy");
    expect(result.valid[0]!.lot_size).toBe(0.5);
    expect(result.valid[0]!.entry_price).toBe(1.085);
    expect(result.valid[0]!.pnl).toBe(250);
    expect(result.valid[0]!.notes).toBe("London breakout");
  });

  it("returns an error when the broker can't be detected", () => {
    const csv = "pair,direction,entry_price\nEURUSD,buy,1.085";
    const result = parseBrokerCsv(csv);
    expect(result.valid).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain("Could not detect broker");
  });

  it("collects validation errors for malformed rows", () => {
    const csv = [
      "Ticket,Open Time,Type,Volume,Symbol,Open Price,SL,TP,Close Time,Close Price,Profit",
      "1,2026.01.15 08:30:00,buy,0.5,FOOBAR,1.0850,1.0800,1.0950,2026.01.15 12:00:00,1.0900,250.00",
    ].join("\n");
    const result = parseBrokerCsv(csv);
    expect(result.valid).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.row).toBe(2);
    expect(result.errors[0]!.error).toContain("pair");
  });

  it("skips blank rows", () => {
    const csv = [
      "Ticket,Open Time,Type,Volume,Symbol,Open Price,SL,TP,Close Time,Close Price,Profit",
      "1,2026.01.15 08:30:00,buy,0.5,EURUSD,1.0850,1.0800,1.0950,2026.01.15 12:00:00,1.0900,250.00",
      ",,,,,,,,,,,",
      "2,2026.01.16 10:00:00,sell,0.3,GBPUSD,1.2800,1.2850,1.2700,2026.01.16 14:00:00,1.2750,150.00",
    ].join("\n");
    const result = parseBrokerCsv(csv);
    expect(result.valid).toHaveLength(2);
  });

  it("returns empty result for empty input", () => {
    expect(parseBrokerCsv("")).toEqual({
      valid: [],
      errors: [{ row: 0, error: "CSV is empty." }],
      total: 0,
    });
  });
});
