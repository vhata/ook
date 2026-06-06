import { describe, expect, it } from "vitest";
import { corpusLastEventDate, shouldAskQuietReturn } from "../../src/lib/admin/quiet-return";
import type { Book } from "../../src/lib/types";

// Builder for a Book with sensible defaults — mirrors the shape used by
// the other /admin helper tests. Tests override only the fields they
// care about.
function book(partial: Partial<Book> & { slug: string; title: string }): Book {
  return {
    authors: ["Author"],
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
    hasProgress: false,
    premise: null,
    goodreadsId: null,
    hardcoverSlug: null,
    storygraphSlug: null,
    bookwyrmUrl: null,
    amazonAsin: null,
    source: null,
    hideExternalReviews: false,
    pages: null,
    trigger: null,
    ...partial,
  } as Book;
}

describe("corpusLastEventDate", () => {
  it("returns null for an empty corpus and no log dates", () => {
    expect(corpusLastEventDate([], [])).toBeNull();
  });

  it("takes the most recent of started / finished / last_progress across books", () => {
    const books = [
      book({ slug: "a", title: "A", started: "2026-01-01", finished: "2026-02-01" }),
      book({ slug: "b", title: "B", last_progress: "2026-03-15" }),
    ];
    expect(corpusLastEventDate(books, [])).toBe("2026-03-15");
  });

  it("includes manual log entry dates in the max", () => {
    const books = [book({ slug: "a", title: "A", finished: "2026-01-10" })];
    expect(corpusLastEventDate(books, ["2026-04-20", "2026-02-01"])).toBe("2026-04-20");
  });

  it("ignores null / empty date fields", () => {
    const books = [
      book({ slug: "a", title: "A", started: null, finished: "", last_progress: "2026-05-05" }),
    ];
    expect(corpusLastEventDate(books, [])).toBe("2026-05-05");
  });

  it("returns the log date when the corpus has no dated events", () => {
    const books = [book({ slug: "a", title: "A" })];
    expect(corpusLastEventDate(books, ["2026-06-01"])).toBe("2026-06-01");
  });
});

describe("shouldAskQuietReturn", () => {
  const today = new Date("2026-06-05T12:00:00Z");

  it("does not ask when there is no prior event (null lastEventDate)", () => {
    expect(shouldAskQuietReturn({ lastEventDate: null, today })).toBe(false);
  });

  it("does not ask when the gap is under the threshold", () => {
    // 13 days before 2026-06-05.
    expect(shouldAskQuietReturn({ lastEventDate: "2026-05-23", today })).toBe(false);
  });

  it("does not ask exactly at the threshold (gap === thresholdDays)", () => {
    // Exactly 14 days — still fresh-enough; the gap must EXCEED the
    // threshold to qualify as a quiet return.
    expect(shouldAskQuietReturn({ lastEventDate: "2026-05-22", today })).toBe(false);
  });

  it("asks once the gap exceeds the threshold", () => {
    // 15 days before 2026-06-05.
    expect(shouldAskQuietReturn({ lastEventDate: "2026-05-21", today })).toBe(true);
  });

  it("asks for a long gap", () => {
    expect(shouldAskQuietReturn({ lastEventDate: "2026-01-01", today })).toBe(true);
  });

  it("honours a custom thresholdDays", () => {
    // 10-day gap, threshold lowered to 7 → asks.
    expect(shouldAskQuietReturn({ lastEventDate: "2026-05-26", today, thresholdDays: 7 })).toBe(
      true,
    );
    // Same gap, threshold raised to 30 → does not ask.
    expect(shouldAskQuietReturn({ lastEventDate: "2026-05-26", today, thresholdDays: 30 })).toBe(
      false,
    );
  });

  it("does not ask when the last event is in the future (clock skew safety)", () => {
    expect(shouldAskQuietReturn({ lastEventDate: "2026-07-01", today })).toBe(false);
  });
});
