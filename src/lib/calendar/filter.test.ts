/**
 * Tests for Phase 19 calendar filter + grouping helpers.
 */
import { describe, it, expect } from "vitest";
import {
  filterEvents,
  groupByDate,
  formatDateKey,
  EMPTY_CALENDAR_FILTER,
  isInNoTradeWindow,
  type EconomicEvent,
} from "@/lib/calendar/schema";

function makeEvent(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: crypto.randomUUID(),
    time: "2026-01-15T12:00:00Z",
    title: "Non-Farm Payrolls",
    currency: "USD",
    impact: "high",
    forecast: "200K",
    previous: "180K",
    ...overrides,
  };
}

describe("filterEvents", () => {
  const events = [
    makeEvent({ id: "1", impact: "high", currency: "USD", time: "2026-01-15T12:00:00Z" }),
    makeEvent({ id: "2", impact: "medium", currency: "EUR", time: "2026-01-15T10:00:00Z" }),
    makeEvent({ id: "3", impact: "low", currency: "GBP", time: "2026-01-16T08:00:00Z" }),
    makeEvent({ id: "4", impact: "high", currency: "JPY", time: "2026-01-17T03:00:00Z" }),
  ];

  it("returns all events with empty filter", () => {
    expect(filterEvents(events, EMPTY_CALENDAR_FILTER)).toHaveLength(4);
  });

  it("filters by impact", () => {
    expect(filterEvents(events, { ...EMPTY_CALENDAR_FILTER, impact: "high" as const })).toHaveLength(2);
    expect(filterEvents(events, { ...EMPTY_CALENDAR_FILTER, impact: "medium" as const })).toHaveLength(1);
    expect(filterEvents(events, { ...EMPTY_CALENDAR_FILTER, impact: "low" as const })).toHaveLength(1);
  });

  it("filters by currency (case-insensitive)", () => {
    expect(filterEvents(events, { ...EMPTY_CALENDAR_FILTER, currency: "USD" })).toHaveLength(1);
    expect(filterEvents(events, { ...EMPTY_CALENDAR_FILTER, currency: "usd" })).toHaveLength(1);
    expect(filterEvents(events, { ...EMPTY_CALENDAR_FILTER, currency: "EUR" })).toHaveLength(1);
    expect(filterEvents(events, { ...EMPTY_CALENDAR_FILTER, currency: "CHF" })).toHaveLength(0);
  });

  it("combines impact + currency", () => {
    const f = { ...EMPTY_CALENDAR_FILTER, impact: "high" as const, currency: "JPY" };
    expect(filterEvents(events, f)).toHaveLength(1);
    expect(filterEvents(events, f)[0]!.id).toBe("4");
  });

  it("noTradeOnly returns only events in the no-trade window", () => {
    // Event at 2026-01-15T12:00:00Z, high impact -> window is
    // 11:45 - 12:15 UTC. "Now" = 12:05 is inside.
    const now = Date.parse("2026-01-15T12:05:00Z");
    const f = { ...EMPTY_CALENDAR_FILTER, noTradeOnly: true };
    const inWindow = filterEvents(events, f, now);
    expect(inWindow).toHaveLength(1);
    expect(inWindow[0]!.id).toBe("1");
  });

  it("noTradeOnly with no events in window returns empty", () => {
    const now = Date.parse("2026-01-20T00:00:00Z");
    expect(filterEvents(events, { ...EMPTY_CALENDAR_FILTER, noTradeOnly: true }, now)).toHaveLength(0);
  });
});

describe("groupByDate", () => {
  it("returns empty for empty input", () => {
    expect(groupByDate([])).toEqual([]);
  });

  it("groups events by YYYY-MM-DD", () => {
    const events = [
      makeEvent({ id: "1", time: "2026-01-15T12:00:00Z" }),
      makeEvent({ id: "2", time: "2026-01-15T08:00:00Z" }),
      makeEvent({ id: "3", time: "2026-01-16T10:00:00Z" }),
    ];
    const groups = groupByDate(events);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.date).toBe("2026-01-15");
    expect(groups[0]!.events).toHaveLength(2);
    // Sorted ascending within the group.
    expect(groups[0]!.events[0]!.id).toBe("2"); // 08:00 before 12:00
    expect(groups[1]!.date).toBe("2026-01-16");
  });

  it("sorts groups by date ascending", () => {
    const events = [
      makeEvent({ id: "1", time: "2026-01-17T12:00:00Z" }),
      makeEvent({ id: "2", time: "2026-01-15T12:00:00Z" }),
    ];
    const groups = groupByDate(events);
    expect(groups[0]!.date).toBe("2026-01-15");
    expect(groups[1]!.date).toBe("2026-01-17");
  });

  it("skips events with unparseable time", () => {
    const events = [
      makeEvent({ id: "1", time: "not-a-date" }),
      makeEvent({ id: "2", time: "2026-01-15T12:00:00Z" }),
    ];
    const groups = groupByDate(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.events).toHaveLength(1);
  });
});

describe("formatDateKey", () => {
  it("formats a YYYY-MM-DD key as 'Mon, Jan 15'", () => {
    // 2026-01-15 is a Thursday.
    const s = formatDateKey("2026-01-15");
    expect(s).toContain("Jan");
    expect(s).toContain("15");
  });

  it("returns the input unchanged for an invalid key", () => {
    expect(formatDateKey("not-a-date")).toBe("not-a-date");
  });
});

describe("isInNoTradeWindow (regression)", () => {
  it("high-impact event has a 15-min window each side", () => {
    const e = makeEvent({ impact: "high", time: "2026-01-15T12:00:00Z" });
    // 11:44 = 16 min before -> outside.
    expect(isInNoTradeWindow(e, Date.parse("2026-01-15T11:44:00Z"))).toBe(false);
    // 11:45 = 15 min before -> boundary, inside (inclusive).
    expect(isInNoTradeWindow(e, Date.parse("2026-01-15T11:45:00Z"))).toBe(true);
    expect(isInNoTradeWindow(e, Date.parse("2026-01-15T12:00:00Z"))).toBe(true);
    expect(isInNoTradeWindow(e, Date.parse("2026-01-15T12:15:00Z"))).toBe(true);
    // 12:16 = 16 min after -> outside.
    expect(isInNoTradeWindow(e, Date.parse("2026-01-15T12:16:00Z"))).toBe(false);
  });

  it("low-impact events have no window", () => {
    const e = makeEvent({ impact: "low", time: "2026-01-15T12:00:00Z" });
    expect(isInNoTradeWindow(e, Date.parse("2026-01-15T12:00:00Z"))).toBe(false);
  });
});
