import { describe, expect, it } from "vitest";
import {
  daysSinceLastProgress,
  effectiveStatus,
  isFreshReading,
  splitNowBooks,
} from "../../src/lib/status";
import type { Book } from "../../src/lib/types";

const TODAY = new Date("2026-05-10T12:00:00Z");

function daysAgo(n: number, from: Date = TODAY): string {
  const ms = from.getTime() - n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

describe("effectiveStatus", () => {
  it("passes through non-reading statuses untouched", () => {
    expect(effectiveStatus("tbr", null, TODAY)).toBe("tbr");
    expect(effectiveStatus("finished", null, TODAY)).toBe("finished");
    expect(effectiveStatus("abandoned", null, TODAY)).toBe("abandoned");
  });

  it("user-set paused wins over any timer state", () => {
    // Even with very recent last_progress, an explicit paused stays paused.
    expect(effectiveStatus("paused", daysAgo(1), TODAY)).toBe("paused");
    expect(effectiveStatus("paused", daysAgo(0), TODAY)).toBe("paused");
  });

  it("reading + fresh last_progress (< 14 days) → reading", () => {
    expect(effectiveStatus("reading", daysAgo(0), TODAY)).toBe("reading");
    expect(effectiveStatus("reading", daysAgo(13), TODAY)).toBe("reading");
  });

  it("reading at the 14-day boundary stays reading", () => {
    // The 14-day boundary marks "no longer fresh" but isn't paused yet.
    expect(effectiveStatus("reading", daysAgo(14), TODAY)).toBe("reading");
  });

  it("reading + medium-stale last_progress (14..90 days) → reading", () => {
    expect(effectiveStatus("reading", daysAgo(15), TODAY)).toBe("reading");
    expect(effectiveStatus("reading", daysAgo(89), TODAY)).toBe("reading");
    expect(effectiveStatus("reading", daysAgo(90), TODAY)).toBe("reading");
  });

  it("reading + last_progress > 90 days → paused", () => {
    expect(effectiveStatus("reading", daysAgo(91), TODAY)).toBe("paused");
    expect(effectiveStatus("reading", daysAgo(365), TODAY)).toBe("paused");
  });

  it("reading with no last_progress falls back to started", () => {
    expect(effectiveStatus("reading", null, TODAY, daysAgo(5))).toBe("reading");
    expect(effectiveStatus("reading", undefined, TODAY, daysAgo(5))).toBe("reading");
    expect(effectiveStatus("reading", null, TODAY, daysAgo(120))).toBe("paused");
  });

  it("reading with neither last_progress nor started auto-promotes to paused", () => {
    expect(effectiveStatus("reading", null, TODAY)).toBe("paused");
    expect(effectiveStatus("reading", null, TODAY, null)).toBe("paused");
  });

  it("reading with an unparseable last_progress returns the stored status untouched", () => {
    expect(effectiveStatus("reading", "not-a-date", TODAY)).toBe("reading");
  });
});

describe("isFreshReading", () => {
  it("true under FRESH_DAYS, false at and over the boundary", () => {
    expect(isFreshReading("reading", daysAgo(0), TODAY)).toBe(true);
    expect(isFreshReading("reading", daysAgo(13), TODAY)).toBe(true);
    expect(isFreshReading("reading", daysAgo(14), TODAY)).toBe(false);
    expect(isFreshReading("reading", daysAgo(40), TODAY)).toBe(false);
  });

  it("false for non-reading statuses", () => {
    expect(isFreshReading("paused", daysAgo(0), TODAY)).toBe(false);
    expect(isFreshReading("finished", daysAgo(0), TODAY)).toBe(false);
  });

  it("falls back to started when last_progress is missing", () => {
    expect(isFreshReading("reading", null, TODAY, daysAgo(5))).toBe(true);
    expect(isFreshReading("reading", null, TODAY, daysAgo(40))).toBe(false);
  });

  it("false when no anchor at all", () => {
    expect(isFreshReading("reading", null, TODAY)).toBe(false);
  });
});

describe("daysSinceLastProgress", () => {
  it("computes whole UTC days from last_progress", () => {
    expect(daysSinceLastProgress(daysAgo(0), TODAY)).toBe(0);
    expect(daysSinceLastProgress(daysAgo(1), TODAY)).toBe(1);
    expect(daysSinceLastProgress(daysAgo(120), TODAY)).toBe(120);
  });

  it("falls back to started when last_progress is missing", () => {
    expect(daysSinceLastProgress(null, TODAY, daysAgo(7))).toBe(7);
    expect(daysSinceLastProgress(undefined, TODAY, daysAgo(7))).toBe(7);
  });

  it("returns null when no anchor exists", () => {
    expect(daysSinceLastProgress(null, TODAY)).toBeNull();
    expect(daysSinceLastProgress(null, TODAY, null)).toBeNull();
  });

  it("returns null for unparseable date strings", () => {
    expect(daysSinceLastProgress("not-a-date", TODAY)).toBeNull();
  });
});

function book(overrides: Partial<Book> & { slug: string }): Book {
  return {
    title: overrides.slug,
    authors: [],
    series: null,
    status: "tbr",
    progress: "",
    started: null,
    last_progress: null,
    finished: null,
    rating: null,
    wouldReread: null,
    bingoSquares: [],
    tags: [],
    cover: null,
    pullquote: null,
    seeAlso: [],
    lastEdited: null,
    hasReview: false,
    hasQuotes: false,
    hasSummary: false,
    premise: null,
    goodreadsId: null,
    hardcoverSlug: null,
    storygraphSlug: null,
    bookwyrmUrl: null,
    source: null,
    hideExternalReviews: false,
    ...overrides,
  };
}

describe("splitNowBooks", () => {
  it("places fresh and quiet reading books in `reading`", () => {
    const fresh = book({ slug: "fresh", status: "reading", last_progress: daysAgo(2) });
    const quiet = book({ slug: "quiet", status: "reading", last_progress: daysAgo(40) });
    const { reading, paused } = splitNowBooks([fresh, quiet], TODAY);
    expect(reading.map((b) => b.slug)).toEqual(["fresh", "quiet"]);
    expect(paused).toEqual([]);
  });

  it("auto-promotes a stale reading book into `paused`", () => {
    const stale = book({ slug: "stale", status: "reading", last_progress: daysAgo(120) });
    const { reading, paused } = splitNowBooks([stale], TODAY);
    expect(reading).toEqual([]);
    expect(paused.map((b) => b.slug)).toEqual(["stale"]);
  });

  it("respects an explicit `paused` status regardless of timer", () => {
    const userPaused = book({ slug: "user-paused", status: "paused", last_progress: daysAgo(1) });
    const { reading, paused } = splitNowBooks([userPaused], TODAY);
    expect(reading).toEqual([]);
    expect(paused.map((b) => b.slug)).toEqual(["user-paused"]);
  });

  it("filters out books with unrelated statuses", () => {
    const finished = book({ slug: "f", status: "finished" });
    const tbr = book({ slug: "t", status: "tbr" });
    const abandoned = book({ slug: "a", status: "abandoned" });
    const reading = book({ slug: "r", status: "reading", last_progress: daysAgo(2) });
    const result = splitNowBooks([finished, tbr, abandoned, reading], TODAY);
    expect(result.reading.map((b) => b.slug)).toEqual(["r"]);
    expect(result.paused).toEqual([]);
  });

  it("sorts paused books by most-recently-active first", () => {
    const old = book({ slug: "old", status: "paused", last_progress: daysAgo(300) });
    const recent = book({ slug: "recent", status: "paused", last_progress: daysAgo(95) });
    const { paused } = splitNowBooks([old, recent], TODAY);
    expect(paused.map((b) => b.slug)).toEqual(["recent", "old"]);
  });
});
