import { describe, expect, it } from "vitest";
import { pctChange } from "@/lib/prices/schema";

describe("pctChange", () => {
  it("returns null without a baseline (change badge hidden)", () => {
    expect(pctChange(null, 1.1)).toBeNull();
    expect(pctChange(undefined, 1.1)).toBeNull();
  });

  it("returns null when nothing has moved yet", () => {
    expect(pctChange(1.10381, 1.10381)).toBeNull();
  });

  it("computes a positive percentage change", () => {
    expect(pctChange(1.0, 1.01)).toBeCloseTo(1.0, 5);
  });

  it("computes a negative percentage change", () => {
    expect(pctChange(1.0, 0.99)).toBeCloseTo(-1.0, 5);
  });

  it("rejects invalid inputs", () => {
    expect(pctChange(NaN, 1.1)).toBeNull();
    expect(pctChange(0, 1.1)).toBeNull();
    expect(pctChange(-1, 1.1)).toBeNull();
    expect(pctChange(1.1, NaN)).toBeNull();
    expect(pctChange(1.1, 0)).toBeNull();
  });
});
