/**
 * Tests for the watchlist + price-alert pure helpers (Phase 22).
 */
import { describe, it, expect } from "vitest";
import { checkAlert, describeAlert, alertAddSchema } from "@/lib/watchlist/schema";

describe("checkAlert", () => {
  it("above: triggers when rate >= threshold", () => {
    const a = { direction: "above" as const, threshold: 1.1 };
    expect(checkAlert(a, 1.1)).toBe(true);
    expect(checkAlert(a, 1.1001)).toBe(true);
    expect(checkAlert(a, 1.0999)).toBe(false);
  });

  it("below: triggers when rate <= threshold", () => {
    const a = { direction: "below" as const, threshold: 1.08 };
    expect(checkAlert(a, 1.08)).toBe(true);
    expect(checkAlert(a, 1.0799)).toBe(true);
    expect(checkAlert(a, 1.0801)).toBe(false);
  });

  it("returns false for invalid rate", () => {
    const a = { direction: "above" as const, threshold: 1.1 };
    expect(checkAlert(a, NaN)).toBe(false);
    expect(checkAlert(a, 0)).toBe(false);
    expect(checkAlert(a, -1)).toBe(false);
  });

  it("returns false for invalid threshold", () => {
    expect(checkAlert({ direction: "above", threshold: NaN }, 1.1)).toBe(false);
    expect(checkAlert({ direction: "above", threshold: 0 }, 1.1)).toBe(false);
    expect(checkAlert({ direction: "above", threshold: -1 }, 1.1)).toBe(false);
  });
});

describe("describeAlert", () => {
  it("formats pair + direction + threshold", () => {
    expect(
      describeAlert({ pair: "EURUSD", direction: "above", threshold: 1.1 }),
    ).toBe("EURUSD above 1.1");
    expect(
      describeAlert({ pair: "USDJPY", direction: "below", threshold: 150 }),
    ).toBe("USDJPY below 150");
  });
});

describe("alertAddSchema", () => {
  const valid = {
    pair: "EURUSD",
    direction: "above" as const,
    threshold: 1.1,
  };

  it("accepts a valid alert", () => {
    expect(alertAddSchema.safeParse(valid).success).toBe(true);
  });

  it("normalizes pair case", () => {
    const r = alertAddSchema.safeParse({ ...valid, pair: "eurusd" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pair).toBe("EURUSD");
  });

  it("rejects an unsupported pair", () => {
    expect(alertAddSchema.safeParse({ ...valid, pair: "FOOBAR" }).success).toBe(false);
  });

  it("rejects a non-positive threshold", () => {
    expect(alertAddSchema.safeParse({ ...valid, threshold: 0 }).success).toBe(false);
    expect(alertAddSchema.safeParse({ ...valid, threshold: -1 }).success).toBe(false);
  });

  it("rejects an invalid direction", () => {
    expect(
      alertAddSchema.safeParse({ ...valid, direction: "sideways" }).success,
    ).toBe(false);
  });
});
