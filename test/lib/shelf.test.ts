import { describe, expect, it } from "vitest";
import {
  SPINE_FALLBACK_WIDTH,
  SPINE_MAX_WIDTH,
  SPINE_MIN_WIDTH,
  buildShelfItems,
  computeSpineWidth,
  yearOfFinish,
} from "../../src/lib/shelf";

type FixtureBook = { slug: string; finished: string | null };
const mk = (slug: string, finished: string | null): FixtureBook => ({ slug, finished });

describe("computeSpineWidth", () => {
  it("returns the fallback width when pages is null", () => {
    expect(computeSpineWidth(null)).toBe(SPINE_FALLBACK_WIDTH);
  });

  it("returns the fallback width when pages is undefined", () => {
    expect(computeSpineWidth(undefined)).toBe(SPINE_FALLBACK_WIDTH);
  });

  it("returns the fallback width for non-positive page counts", () => {
    expect(computeSpineWidth(0)).toBe(SPINE_FALLBACK_WIDTH);
    expect(computeSpineWidth(-50)).toBe(SPINE_FALLBACK_WIDTH);
  });

  it("returns the fallback width for non-finite page counts", () => {
    expect(computeSpineWidth(Number.NaN)).toBe(SPINE_FALLBACK_WIDTH);
    expect(computeSpineWidth(Number.POSITIVE_INFINITY)).toBe(SPINE_FALLBACK_WIDTH);
  });

  it("clamps thin books up to the minimum width", () => {
    // A 100-page novella would round to ~8 px; clamps to MIN.
    expect(computeSpineWidth(100)).toBe(SPINE_MIN_WIDTH);
    // A book at the exact min boundary (288 / 12 = 24) lands on MIN.
    expect(computeSpineWidth(288)).toBe(SPINE_MIN_WIDTH);
  });

  it("scales linearly through the mid-range", () => {
    // 300 / 12 = 25
    expect(computeSpineWidth(300)).toBe(25);
    // 600 / 12 = 50
    expect(computeSpineWidth(600)).toBe(50);
  });

  it("clamps doorstoppers down to the maximum width", () => {
    // 864 / 12 = 72 — exactly MAX.
    expect(computeSpineWidth(864)).toBe(SPINE_MAX_WIDTH);
    // Anything above clamps.
    expect(computeSpineWidth(1200)).toBe(SPINE_MAX_WIDTH);
    expect(computeSpineWidth(5000)).toBe(SPINE_MAX_WIDTH);
  });

  it("rounds half values to the nearest integer", () => {
    // 306 / 12 = 25.5 → 26 (round-half-up via Math.round).
    expect(computeSpineWidth(306)).toBe(26);
  });
});

describe("yearOfFinish", () => {
  it("extracts the year from a YYYY-MM-DD string", () => {
    expect(yearOfFinish("2025-03-14")).toBe(2025);
    expect(yearOfFinish("1999-12-31")).toBe(1999);
  });

  it("returns null for a null or malformed date", () => {
    expect(yearOfFinish(null)).toBeNull();
    expect(yearOfFinish("")).toBeNull();
    expect(yearOfFinish("abc")).toBeNull();
  });
});

describe("buildShelfItems", () => {
  it("returns spines only when year breaks are disabled", () => {
    const books = [mk("a", "2025-01-01"), mk("b", "2024-06-01")];
    const items = buildShelfItems(books, false);
    expect(items).toEqual([
      { kind: "spine", book: books[0] },
      { kind: "spine", book: books[1] },
    ]);
  });

  it("inserts a year-break between books that crossed a year boundary", () => {
    const books = [
      mk("recent", "2025-03-14"),
      mk("late-2024", "2024-12-01"),
      mk("mid-2024", "2024-06-01"),
      mk("early-2023", "2023-04-01"),
    ];
    const items = buildShelfItems(books, true);
    expect(items).toEqual([
      { kind: "spine", book: books[0] },
      { kind: "year-break", year: 2024 },
      { kind: "spine", book: books[1] },
      { kind: "spine", book: books[2] },
      { kind: "year-break", year: 2023 },
      { kind: "spine", book: books[3] },
    ]);
  });

  it("treats currently-reading books as an 'ongoing' bucket with no tick of their own", () => {
    // Two currently-reading books at the head, then finished books — the
    // first finished book opens its year stripe, the ongoing bucket itself
    // never emits a year-break marker.
    const books = [
      mk("reading-a", null),
      mk("reading-b", null),
      mk("finished-2025", "2025-03-14"),
      mk("finished-2024", "2024-09-01"),
    ];
    const items = buildShelfItems(books, true);
    expect(items).toEqual([
      { kind: "spine", book: books[0] },
      { kind: "spine", book: books[1] },
      { kind: "year-break", year: 2025 },
      { kind: "spine", book: books[2] },
      { kind: "year-break", year: 2024 },
      { kind: "spine", book: books[3] },
    ]);
  });

  it("emits no year-break when all books are within the same year", () => {
    const books = [mk("a", "2025-03-14"), mk("b", "2025-01-01")];
    const items = buildShelfItems(books, true);
    expect(items).toEqual([
      { kind: "spine", book: books[0] },
      { kind: "spine", book: books[1] },
    ]);
  });

  it("never emits a year-break before the first item", () => {
    const items = buildShelfItems([mk("only", "2024-01-01")], true);
    expect(items).toEqual([{ kind: "spine", book: { slug: "only", finished: "2024-01-01" } }]);
  });
});
