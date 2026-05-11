import { describe, expect, it } from "vitest";
import {
  bingoAt,
  finishedAt,
  isFinishedAt,
  isReadingAt,
  makeTimeMachine,
  readingAt,
} from "../../src/lib/time-machine";
import type { BingoCard, Book } from "../../src/lib/types";

function book(overrides: Partial<Book>): Book {
  return {
    slug: "x",
    title: "x",
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

describe("makeTimeMachine", () => {
  it("accepts well-formed YYYY-MM-DD", () => {
    expect(makeTimeMachine("2026-05-05")?.at).toBe("2026-05-05");
  });

  it("rejects malformed input", () => {
    expect(makeTimeMachine("not-a-date")).toBeNull();
    expect(makeTimeMachine("2026-5-5")).toBeNull();
    expect(makeTimeMachine("2026-13-01")).toBeNull();
  });
});

describe("isReadingAt", () => {
  it("considers a book reading when started <= D and finished is null", () => {
    expect(isReadingAt(book({ slug: "a", started: "2026-01-01" }), "2026-05-05")).toBe(true);
  });

  it("considers a book reading when started <= D and finished > D", () => {
    expect(
      isReadingAt(book({ slug: "a", started: "2026-01-01", finished: "2026-06-01" }), "2026-05-05"),
    ).toBe(true);
  });

  it("rejects books not yet started at D", () => {
    expect(isReadingAt(book({ slug: "a", started: "2026-06-01" }), "2026-05-05")).toBe(false);
  });

  it("rejects books finished on or before D", () => {
    expect(
      isReadingAt(book({ slug: "a", started: "2026-01-01", finished: "2026-05-05" }), "2026-05-05"),
    ).toBe(false);
  });

  it("rejects books with no started date", () => {
    expect(isReadingAt(book({ slug: "a", started: null }), "2026-05-05")).toBe(false);
  });
});

describe("isFinishedAt", () => {
  it("only counts books with a finish date <= D", () => {
    expect(isFinishedAt(book({ finished: "2026-05-05" }), "2026-05-05")).toBe(true);
    expect(isFinishedAt(book({ finished: "2026-05-04" }), "2026-05-05")).toBe(true);
    expect(isFinishedAt(book({ finished: "2026-05-06" }), "2026-05-05")).toBe(false);
    expect(isFinishedAt(book({ finished: null }), "2026-05-05")).toBe(false);
  });
});

describe("readingAt + finishedAt", () => {
  const corpus: Book[] = [
    book({ slug: "early", started: "2026-01-01", finished: "2026-02-01" }),
    book({ slug: "mid", started: "2026-03-01", finished: "2026-04-15" }),
    book({ slug: "current", started: "2026-04-20" }),
    book({ slug: "future", started: "2026-06-01" }),
  ];

  it("readingAt returns books in flight at the lens date", () => {
    expect(readingAt(corpus, "2026-05-01").map((b) => b.slug)).toEqual(["current"]);
  });

  it("finishedAt sorts by finish date desc and respects limit", () => {
    expect(finishedAt(corpus, "2026-05-01").map((b) => b.slug)).toEqual(["mid", "early"]);
    expect(finishedAt(corpus, "2026-05-01", 1).map((b) => b.slug)).toEqual(["mid"]);
  });
});

describe("bingoAt", () => {
  const sample: BingoCard = {
    year: 2026,
    title: "2026 Bingo",
    size: 3,
    freeSquare: "center",
    squares: [
      {
        id: "a1",
        title: "Bound book",
        authors: [],
        book: "bound",
        cover: null,
        done: true, // will be overridden by lens
        reading: false,
        free: false,
      },
      {
        id: "a2",
        title: "Unbound",
        authors: [],
        book: null,
        cover: null,
        done: false,
        reading: false,
        free: false,
      },
    ],
  };

  it("re-derives done/reading from the linked book at the lens date", () => {
    const bound = book({ slug: "bound", started: "2026-01-01", finished: "2026-08-01" });
    const lens = bingoAt(sample, "2026-05-01", new Map([["bound", bound]]));
    const a1 = lens.squares.find((s) => s.id === "a1");
    expect(a1?.done).toBe(false); // not yet finished by 2026-05-01
    expect(a1?.reading).toBe(true);
  });

  it("leaves unbound squares untouched", () => {
    const lens = bingoAt(sample, "2026-05-01", new Map());
    const a2 = lens.squares.find((s) => s.id === "a2");
    expect(a2?.done).toBe(false);
    expect(a2?.reading).toBe(false);
  });
});
