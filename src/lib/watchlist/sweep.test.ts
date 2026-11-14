import { describe, expect, it } from "vitest";
import { selectTriggered, type PendingAlert } from "@/lib/watchlist/sweep";

function alert(
  overrides: Partial<PendingAlert> & Pick<PendingAlert, "id" | "pair">,
): PendingAlert {
  return {
    userId: "00000000-0000-0000-0000-000000000000",
    direction: "above",
    threshold: 1.1,
    ...overrides,
  };
}

const rates = { EURUSD: 1.105, USDJPY: 154.2, XAUUSD: 2320 };

describe("selectTriggered", () => {
  it("fires 'above' when rate >= threshold", () => {
    const a = alert({ id: "a1", pair: "EURUSD", direction: "above", threshold: 1.1 });
    expect(selectTriggered([a], rates)).toEqual([a]);
  });

  it("fires 'below' when rate <= threshold", () => {
    const a = alert({ id: "a1", pair: "USDJPY", direction: "below", threshold: 155 });
    expect(selectTriggered([a], rates)).toEqual([a]);
  });

  it("does not fire when the rate is on the wrong side", () => {
    const above = alert({ id: "a1", pair: "EURUSD", direction: "above", threshold: 1.2 });
    const below = alert({ id: "a2", pair: "XAUUSD", direction: "below", threshold: 2300 });
    expect(selectTriggered([above, below], rates)).toEqual([]);
  });

  it("skips alerts whose pair has no cached rate (left pending)", () => {
    const a = alert({ id: "a1", pair: "NZDUSD", direction: "above", threshold: 0.5 });
    expect(selectTriggered([a], rates)).toEqual([]);
  });

  it("handles threshold exactly at the rate", () => {
    const a = alert({ id: "a1", pair: "XAUUSD", direction: "above", threshold: 2320 });
    expect(selectTriggered([a], rates)).toEqual([a]);
  });

  it("handles an empty rate map (no fires)", () => {
    const a = alert({ id: "a1", pair: "EURUSD" });
    expect(selectTriggered([a], {})).toEqual([]);
  });
});
