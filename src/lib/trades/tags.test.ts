/**
 * Tests for Phase 18: trade tags + multi-filter analytics.
 *
 * Covers three pure modules:
 *  - slugifyTag / normalizeTags (schema.ts)
 *  - parseTradeFilter / matchesFilter / applyTradeFilter (schema.ts)
 *  - perTagStats (analytics.ts)
 *
 * No DB / Supabase. All inputs are in-memory.
 */
import { describe, it, expect } from "vitest";
import {
  slugifyTag,
  normalizeTags,
  parseTradeFilter,
  matchesFilter,
  applyTradeFilter,
  isFilterEmpty,
  EMPTY_FILTER,
  MAX_TAGS,
  MAX_TAG_LEN,
  tradeCreateSchema,
  type TradeRow,
  type TradeFilter,
} from "@/lib/trades/schema";
import { perTagStats } from "@/lib/trades/analytics";

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
    pnl: 0,
    strategy: "trend",
    session: "london",
    emotion: null,
    followed_plan: true,
    notes: null,
    created_at: "2026-01-15T08:30:00Z",
    tags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// slugifyTag
// ---------------------------------------------------------------------------

describe("slugifyTag", () => {
  it("lowercases letters", () => {
    expect(slugifyTag("FOMC")).toBe("fomc");
    expect(slugifyTag("Breakout")).toBe("breakout");
  });

  it("trims leading and trailing whitespace", () => {
    expect(slugifyTag("  breakout  ")).toBe("breakout");
    expect(slugifyTag("\trend\t")).toBe("rend");
  });

  it("replaces whitespace runs with a single dash", () => {
    expect(slugifyTag("FOMC 2026")).toBe("fomc-2026");
    expect(slugifyTag("london   open")).toBe("london-open");
  });

  it("replaces disallowed chars with a dash (keeps underscore)", () => {
    // Underscore is in the allowed set, so "trend_follow!" becomes
    // "trend_follow" (the ! becomes a trailing dash, then trimmed).
    expect(slugifyTag("trend_follow!")).toBe("trend_follow");
    expect(slugifyTag("a.b.c")).toBe("a-b-c");
    expect(slugifyTag("revenge#1")).toBe("revenge-1");
  });

  it("keeps alphanumerics, dash, and underscore", () => {
    expect(slugifyTag("trend_follow-1")).toBe("trend_follow-1");
    expect(slugifyTag("fomc-2026-a")).toBe("fomc-2026-a");
  });

  it("collapses repeated dashes", () => {
    expect(slugifyTag("a   b!!!c")).toBe("a-b-c");
    expect(slugifyTag("---foo---bar---")).toBe("foo-bar");
  });

  it("returns empty for empty / whitespace-only input", () => {
    expect(slugifyTag("")).toBe("");
    expect(slugifyTag("   ")).toBe("");
    expect(slugifyTag("!!!")).toBe("");
  });

  it("returns empty for non-string input", () => {
    expect(slugifyTag(undefined as unknown as string)).toBe("");
    expect(slugifyTag(null as unknown as string)).toBe("");
    expect(slugifyTag(42 as unknown as string)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normalizeTags
// ---------------------------------------------------------------------------

describe("normalizeTags", () => {
  it("returns [] for null / undefined / empty string", () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags("")).toEqual([]);
    expect(normalizeTags("   ")).toEqual([]);
  });

  it("returns [] for non-string non-array input", () => {
    expect(normalizeTags(42)).toEqual([]);
    expect(normalizeTags({ foo: "bar" })).toEqual([]);
    expect(normalizeTags(true)).toEqual([]);
  });

  it("splits a comma-separated string", () => {
    expect(normalizeTags("fomc, breakout, trend")).toEqual([
      "fomc",
      "breakout",
      "trend",
    ]);
  });

  it("splits a whitespace-separated string", () => {
    expect(normalizeTags("fomc breakout trend")).toEqual([
      "fomc",
      "breakout",
      "trend",
    ]);
  });

  it("splits a newline-separated string", () => {
    expect(normalizeTags("fomc\nbreakout\ntrend")).toEqual([
      "fomc",
      "breakout",
      "trend",
    ]);
  });

  it("accepts an array and slugifies each element", () => {
    expect(normalizeTags(["FOMC", "Breakout", "trend-follow"])).toEqual([
      "fomc",
      "breakout",
      "trend-follow",
    ]);
  });

  it("dedupes case-insensitively (after slugify)", () => {
    expect(normalizeTags("FOMC, fomc, FoMc")).toEqual(["fomc"]);
    expect(normalizeTags(["Breakout", "BREAKOUT", "breakout"])).toEqual([
      "breakout",
    ]);
  });

  it("drops empty and whitespace-only entries", () => {
    expect(normalizeTags("fomc, , , breakout")).toEqual(["fomc", "breakout"]);
    expect(normalizeTags(["", "  ", "fomc", "!!!"])).toEqual(["fomc"]);
  });

  it("caps at MAX_TAGS entries", () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `tag${i}`);
    const result = normalizeTags(many);
    expect(result).toHaveLength(MAX_TAGS);
    // First MAX_TAGS distinct tags are kept in order.
    expect(result[0]).toBe("tag0");
    expect(result[MAX_TAGS - 1]).toBe(`tag${MAX_TAGS - 1}`);
  });

  it("truncates tags longer than MAX_TAG_LEN", () => {
    const long = "a".repeat(MAX_TAG_LEN + 10);
    const result = normalizeTags([long]);
    expect(result).toHaveLength(1);
    expect(result[0]!.length).toBeLessThanOrEqual(MAX_TAG_LEN);
  });

  it("preserves order of first occurrence (after dedupe)", () => {
    expect(normalizeTags("c, a, b, a, c, b")).toEqual(["c", "a", "b"]);
  });

  it("handles mixed input types in an array", () => {
    expect(normalizeTags(["FOMC", 42, null, "Breakout"] as unknown[])).toEqual([
      "fomc",
      "breakout",
    ]);
  });
});

// ---------------------------------------------------------------------------
// tradeCreateSchema integration with tags
// ---------------------------------------------------------------------------

describe("tradeCreateSchema with tags", () => {
  const baseValid = {
    pair: "EURUSD",
    direction: "buy" as const,
    entry_price: 1.085,
    stop_loss: 1.08,
    lot_size: 0.5,
    opened_at: "2026-01-15T08:30:00Z",
  };

  it("accepts a string and normalizes to an array", () => {
    const parsed = tradeCreateSchema.safeParse({
      ...baseValid,
      tags: "FOMC, breakout, trend",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tags).toEqual(["fomc", "breakout", "trend"]);
    }
  });

  it("accepts an array and slugifies", () => {
    const parsed = tradeCreateSchema.safeParse({
      ...baseValid,
      tags: ["FOMC", "Breakout!"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tags).toEqual(["fomc", "breakout"]);
    }
  });

  it("defaults to [] when tags omitted", () => {
    const parsed = tradeCreateSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tags).toEqual([]);
    }
  });

  it("treats null as []", () => {
    const parsed = tradeCreateSchema.safeParse({ ...baseValid, tags: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tags).toEqual([]);
    }
  });

  it("treats empty string as []", () => {
    const parsed = tradeCreateSchema.safeParse({ ...baseValid, tags: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tags).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// parseTradeFilter
// ---------------------------------------------------------------------------

describe("parseTradeFilter", () => {
  it("returns EMPTY_FILTER for empty input", () => {
    expect(parseTradeFilter({})).toEqual(EMPTY_FILTER);
    expect(isFilterEmpty(parseTradeFilter({}))).toBe(true);
  });

  it("parses a valid pair", () => {
    const f = parseTradeFilter({ pair: "EURUSD" });
    expect(f.pair).toBe("EURUSD");
  });

  it("lowercases and accepts eurusd / EURUSD alike", () => {
    const f = parseTradeFilter({ pair: "eurusd" });
    expect(f.pair).toBe("EURUSD");
  });

  it("drops an unknown pair", () => {
    const f = parseTradeFilter({ pair: "FOOBAR" });
    expect(f.pair).toBeNull();
  });

  it("parses direction buy / sell, drops anything else", () => {
    expect(parseTradeFilter({ direction: "buy" }).direction).toBe("buy");
    expect(parseTradeFilter({ direction: "SELL" }).direction).toBe("sell");
    expect(parseTradeFilter({ direction: "sideways" }).direction).toBe("all");
  });

  it("slugifies the tag", () => {
    const f = parseTradeFilter({ tag: "FOMC 2026" });
    expect(f.tag).toBe("fomc-2026");
  });

  it("drops a tag that slugifies to empty", () => {
    const f = parseTradeFilter({ tag: "!!!" });
    expect(f.tag).toBeNull();
  });

  it("parses a valid session, drops unknown", () => {
    expect(parseTradeFilter({ session: "london" }).session).toBe("london");
    expect(parseTradeFilter({ session: "LONDON" }).session).toBe("london");
    expect(parseTradeFilter({ session: "lunch" }).session).toBe("all");
  });

  it("keeps strategy as a trimmed string", () => {
    expect(parseTradeFilter({ strategy: "  trend-follow  " }).strategy).toBe(
      "trend-follow",
    );
    expect(parseTradeFilter({ strategy: "" }).strategy).toBeNull();
  });

  it("parses outcome win/loss/open/breakeven, drops unknown", () => {
    expect(parseTradeFilter({ outcome: "win" }).outcome).toBe("win");
    expect(parseTradeFilter({ outcome: "LOSS" }).outcome).toBe("loss");
    expect(parseTradeFilter({ outcome: "open" }).outcome).toBe("open");
    expect(parseTradeFilter({ outcome: "breakeven" }).outcome).toBe("breakeven");
    expect(parseTradeFilter({ outcome: "moon" }).outcome).toBe("all");
  });

  it("parses followed_plan true/false in multiple shapes", () => {
    expect(parseTradeFilter({ followed_plan: "true" }).followedPlan).toBe(true);
    expect(parseTradeFilter({ followed_plan: "1" }).followedPlan).toBe(true);
    expect(parseTradeFilter({ followed_plan: "yes" }).followedPlan).toBe(true);
    expect(parseTradeFilter({ followed_plan: "false" }).followedPlan).toBe(false);
    expect(parseTradeFilter({ followed_plan: "0" }).followedPlan).toBe(false);
    expect(parseTradeFilter({ followed_plan: "no" }).followedPlan).toBe(false);
    expect(parseTradeFilter({ followed_plan: "maybe" }).followedPlan).toBeNull();
  });

  it("parses valid ISO dates for opened_from / opened_to", () => {
    const f = parseTradeFilter({
      opened_from: "2026-01-01T00:00:00Z",
      opened_to: "2026-02-01T00:00:00Z",
    });
    expect(f.openedFrom).toBe("2026-01-01T00:00:00Z");
    expect(f.openedTo).toBe("2026-02-01T00:00:00Z");
  });

  it("drops invalid dates", () => {
    const f = parseTradeFilter({
      opened_from: "not-a-date",
      opened_to: "2026-13-45",
    });
    expect(f.openedFrom).toBeNull();
    expect(f.openedTo).toBeNull();
  });

  it("accepts URLSearchParams as input", () => {
    const params = new URLSearchParams();
    params.set("pair", "GBPUSD");
    params.set("tag", "breakout");
    params.set("outcome", "win");
    const f = parseTradeFilter(params);
    expect(f.pair).toBe("GBPUSD");
    expect(f.tag).toBe("breakout");
    expect(f.outcome).toBe("win");
  });

  it("takes the first value when given an array", () => {
    const f = parseTradeFilter({ pair: ["EURUSD", "GBPUSD"] });
    expect(f.pair).toBe("EURUSD");
  });
});

// ---------------------------------------------------------------------------
// matchesFilter / applyTradeFilter
// ---------------------------------------------------------------------------

describe("matchesFilter", () => {
  const row = makeRow({
    pair: "EURUSD",
    direction: "buy",
    session: "london",
    strategy: "trend-follow",
    pnl: 100,
    closed_at: "2026-01-15T12:00:00Z",
    tags: ["fomc", "breakout"],
    followed_plan: true,
    opened_at: "2026-01-15T08:30:00Z",
  });

  it("matches when filter is empty", () => {
    expect(matchesFilter(row, EMPTY_FILTER)).toBe(true);
  });

  it("filters by pair", () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, pair: "EURUSD" })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, pair: "GBPUSD" })).toBe(false);
  });

  it("filters by direction", () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, direction: "buy" })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, direction: "sell" })).toBe(false);
  });

  it("filters by tag (must be in trade.tags)", () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, tag: "fomc" })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, tag: "breakout" })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, tag: "revenge" })).toBe(false);
  });

  it("filters by session", () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, session: "london" })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, session: "asian" })).toBe(false);
  });

  it("filters by strategy (case-insensitive exact)", () => {
    expect(
      matchesFilter(row, { ...EMPTY_FILTER, strategy: "trend-follow" }),
    ).toBe(true);
    expect(
      matchesFilter(row, { ...EMPTY_FILTER, strategy: "TREND-FOLLOW" }),
    ).toBe(true);
    expect(
      matchesFilter(row, { ...EMPTY_FILTER, strategy: "trend" }),
    ).toBe(false);
  });

  it("filters by followed_plan", () => {
    expect(
      matchesFilter(row, { ...EMPTY_FILTER, followedPlan: true }),
    ).toBe(true);
    expect(
      matchesFilter(row, { ...EMPTY_FILTER, followedPlan: false }),
    ).toBe(false);
  });

  it("filters by outcome: win", () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, outcome: "win" })).toBe(true);
    expect(matchesFilter(makeRow({ pnl: -50 }), { ...EMPTY_FILTER, outcome: "win" })).toBe(false);
  });

  it("filters by outcome: loss (pnl <= 0, closed)", () => {
    expect(
      matchesFilter(makeRow({ pnl: -50 }), { ...EMPTY_FILTER, outcome: "loss" }),
    ).toBe(true);
    expect(
      matchesFilter(makeRow({ pnl: 0 }), { ...EMPTY_FILTER, outcome: "loss" }),
    ).toBe(true);
    expect(
      matchesFilter(makeRow({ pnl: 50 }), { ...EMPTY_FILTER, outcome: "loss" }),
    ).toBe(false);
    // Open trade doesn't match "loss".
    expect(
      matchesFilter(
        makeRow({ pnl: null, closed_at: null }),
        { ...EMPTY_FILTER, outcome: "loss" },
      ),
    ).toBe(false);
  });

  it("filters by outcome: open (no closed_at OR no pnl)", () => {
    expect(
      matchesFilter(
        makeRow({ closed_at: null, pnl: null }),
        { ...EMPTY_FILTER, outcome: "open" },
      ),
    ).toBe(true);
    expect(
      matchesFilter(
        makeRow({ closed_at: "2026-01-15T12:00:00Z", pnl: null }),
        { ...EMPTY_FILTER, outcome: "open" },
      ),
    ).toBe(true);
    // Fully closed trade doesn't match "open".
    expect(
      matchesFilter(row, { ...EMPTY_FILTER, outcome: "open" }),
    ).toBe(false);
  });

  it("filters by outcome: breakeven (pnl === 0)", () => {
    expect(
      matchesFilter(makeRow({ pnl: 0 }), { ...EMPTY_FILTER, outcome: "breakeven" }),
    ).toBe(true);
    expect(
      matchesFilter(makeRow({ pnl: 1 }), { ...EMPTY_FILTER, outcome: "breakeven" }),
    ).toBe(false);
    expect(
      matchesFilter(makeRow({ pnl: null }), { ...EMPTY_FILTER, outcome: "breakeven" }),
    ).toBe(false);
  });

  it("filters by opened_from (inclusive lower bound)", () => {
    expect(
      matchesFilter(row, {
        ...EMPTY_FILTER,
        openedFrom: "2026-01-15T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      matchesFilter(row, {
        ...EMPTY_FILTER,
        openedFrom: "2026-01-16T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("filters by opened_to (inclusive upper bound)", () => {
    expect(
      matchesFilter(row, {
        ...EMPTY_FILTER,
        openedTo: "2026-01-16T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      matchesFilter(row, {
        ...EMPTY_FILTER,
        openedTo: "2026-01-14T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("combines multiple filters (AND)", () => {
    const f: TradeFilter = {
      ...EMPTY_FILTER,
      pair: "EURUSD",
      direction: "buy",
      tag: "fomc",
      outcome: "win",
    };
    expect(matchesFilter(row, f)).toBe(true);
    // Failing any one dimension fails the whole match.
    expect(
      matchesFilter(makeRow({ ...row, direction: "sell" }), f),
    ).toBe(false);
    expect(
      matchesFilter(makeRow({ ...row, tags: ["breakout"] }), f),
    ).toBe(false);
  });
});

describe("applyTradeFilter", () => {
  const trades = [
    makeRow({ id: "1", pair: "EURUSD", direction: "buy", pnl: 100, tags: ["fomc"] }),
    makeRow({ id: "2", pair: "GBPUSD", direction: "sell", pnl: -50, tags: ["fomc"] }),
    makeRow({ id: "3", pair: "EURUSD", direction: "sell", pnl: 200, tags: ["breakout"] }),
    makeRow({ id: "4", pair: "USDJPY", direction: "buy", pnl: null, closed_at: null, tags: [] }),
  ];

  it("returns the input array unchanged when filter is empty", () => {
    expect(applyTradeFilter(trades, EMPTY_FILTER)).toBe(trades);
  });

  it("returns a new filtered array (not the input reference)", () => {
    const filtered = applyTradeFilter(trades, { ...EMPTY_FILTER, pair: "EURUSD" });
    expect(filtered).not.toBe(trades);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("filters by tag", () => {
    const filtered = applyTradeFilter(trades, { ...EMPTY_FILTER, tag: "fomc" });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.id).sort()).toEqual(["1", "2"]);
  });

  it("filters by outcome: open", () => {
    const filtered = applyTradeFilter(trades, { ...EMPTY_FILTER, outcome: "open" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe("4");
  });

  it("combines filters", () => {
    const filtered = applyTradeFilter(trades, {
      ...EMPTY_FILTER,
      pair: "EURUSD",
      outcome: "win",
    });
    expect(filtered).toHaveLength(2);
    // Both EURUSD trades that are winners: id 1 (pnl 100) and id 3 (pnl 200).
    expect(filtered.map((t) => t.id).sort()).toEqual(["1", "3"]);
  });
});

// ---------------------------------------------------------------------------
// isFilterEmpty
// ---------------------------------------------------------------------------

describe("isFilterEmpty", () => {
  it("returns true for EMPTY_FILTER", () => {
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
  });

  it("returns false when any dimension is set", () => {
    expect(isFilterEmpty({ ...EMPTY_FILTER, pair: "EURUSD" })).toBe(false);
    expect(isFilterEmpty({ ...EMPTY_FILTER, direction: "buy" })).toBe(false);
    expect(isFilterEmpty({ ...EMPTY_FILTER, tag: "fomc" })).toBe(false);
    expect(isFilterEmpty({ ...EMPTY_FILTER, outcome: "win" })).toBe(false);
    expect(isFilterEmpty({ ...EMPTY_FILTER, followedPlan: true })).toBe(false);
    expect(isFilterEmpty({ ...EMPTY_FILTER, openedFrom: "2026-01-01" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// perTagStats
// ---------------------------------------------------------------------------

describe("perTagStats", () => {
  it("returns empty for empty input", () => {
    expect(perTagStats([])).toEqual([]);
  });

  it("excludes trades with null pnl", () => {
    const trades = [
      makeRow({ pnl: 100, tags: ["fomc"] }),
      makeRow({ pnl: null, closed_at: null, tags: ["fomc"] }),
    ];
    const stats = perTagStats(trades);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.tag).toBe("fomc");
    expect(stats[0]!.total).toBe(1);
  });

  it("excludes trades with no tags", () => {
    const trades = [
      makeRow({ pnl: 100, tags: [] }),
      makeRow({ pnl: 50, tags: ["fomc"] }),
    ];
    const stats = perTagStats(trades);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.tag).toBe("fomc");
  });

  it("a trade with multiple tags counts in every bucket", () => {
    const trades = [
      makeRow({ pnl: 100, tags: ["fomc", "breakout"] }),
    ];
    const stats = perTagStats(trades);
    expect(stats).toHaveLength(2);
    const tags = stats.map((s) => s.tag).sort();
    expect(tags).toEqual(["breakout", "fomc"]);
    // Both buckets have total=1 because the one trade appears in both.
    for (const s of stats) {
      expect(s.total).toBe(1);
      expect(s.winners).toBe(1);
      expect(s.netPnl).toBe(100);
    }
  });

  it("computes win rate, net pnl, avg pnl per tag", () => {
    const trades = [
      makeRow({ pnl: 100, tags: ["fomc"] }),
      makeRow({ pnl: -50, tags: ["fomc"] }),
      makeRow({ pnl: 200, tags: ["fomc"] }),
    ];
    const stats = perTagStats(trades);
    expect(stats).toHaveLength(1);
    const s = stats[0]!;
    expect(s.tag).toBe("fomc");
    expect(s.total).toBe(3);
    expect(s.winners).toBe(2);
    expect(s.losers).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 5);
    expect(s.netPnl).toBe(250);
    expect(s.avgPnl).toBeCloseTo(250 / 3, 5);
  });

  it("sorts by total desc, then net pnl desc", () => {
    const trades = [
      makeRow({ pnl: 10, tags: ["rare"] }), // 1 trade, +10
      makeRow({ pnl: 100, tags: ["common"] }),
      makeRow({ pnl: -20, tags: ["common"] }), // 2 trades, +80
      makeRow({ pnl: 50, tags: ["frequent"] }),
      makeRow({ pnl: 50, tags: ["frequent"] }),
      makeRow({ pnl: 50, tags: ["frequent"] }), // 3 trades, +150
    ];
    const stats = perTagStats(trades);
    expect(stats.map((s) => s.tag)).toEqual(["frequent", "common", "rare"]);
  });

  it("handles breakeven trades (pnl === 0 counts as a loser)", () => {
    const trades = [
      makeRow({ pnl: 0, tags: ["flat"] }),
    ];
    const stats = perTagStats(trades);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.winners).toBe(0);
    expect(stats[0]!.losers).toBe(1);
    expect(stats[0]!.winRate).toBe(0);
  });

  it("handles tags that appear on both winners and losers", () => {
    const trades = [
      makeRow({ pnl: 100, tags: ["strategy-a"] }),
      makeRow({ pnl: -30, tags: ["strategy-a"] }),
      makeRow({ pnl: -20, tags: ["strategy-a"] }),
      makeRow({ pnl: 80, tags: ["strategy-a"] }),
    ];
    const stats = perTagStats(trades);
    const s = stats[0]!;
    expect(s.total).toBe(4);
    expect(s.winners).toBe(2);
    expect(s.losers).toBe(2);
    expect(s.winRate).toBe(0.5);
    expect(s.netPnl).toBe(130);
  });
});
