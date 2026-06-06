import { describe, expect, it } from "vitest";
import { buildShowcase } from "../../src/lib/showcase";
import type { BingoCard, BingoSquare, Book } from "../../src/lib/types";

// `buildShowcase` is the pure transform behind the public
// `GET /api/showcase.json` endpoint that vhata.net consumes server-side.
// The output shape is a CONTRACT: field names here are depended on by an
// external site, so these tests pin them exactly. The async wiring that
// feeds real vault accessors into this function lives in `getShowcase`;
// the HTTP glue lives in the route. This file pins the shaping rules.

const SITE = "https://b-ook.vercel.app";

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
  };
}

function bingo(partial: Partial<BingoCard> & { year: number }): BingoCard {
  return {
    title: `Bingo ${partial.year}`,
    size: 5,
    freeSquare: null,
    squares: [],
    ...partial,
  };
}

const EMPTY = {
  reading: [] as Book[],
  recentlyFinished: [] as Book[],
  bingo: null as BingoCard | null,
  booksThisYear: 0,
  siteUrl: SITE,
};

describe("buildShowcase — top-level shape", () => {
  it("returns empty arrays and null bingo when the corpus is sparse", () => {
    const out = buildShowcase(EMPTY);
    expect(out.nowReading).toEqual([]);
    expect(out.recentlyFinished).toEqual([]);
    expect(out.bingo).toBeNull();
    expect(out.stats).toEqual({ booksThisYear: 0 });
    expect(out.siteUrl).toBe(SITE);
  });
});

describe("buildShowcase — nowReading", () => {
  it("maps the contract fields and builds an absolute, slug-encoded url", () => {
    const out = buildShowcase({
      ...EMPTY,
      reading: [
        book({
          slug: "piranesi & co",
          title: "Piranesi",
          authors: ["Susanna Clarke"],
          status: "reading",
          cover: "https://covers.example/p.jpg",
          started: "2026-05-01",
          progress: "47%",
          pages: 250,
        }),
      ],
    });
    expect(out.nowReading).toEqual([
      {
        title: "Piranesi",
        author: "Susanna Clarke",
        cover: "https://covers.example/p.jpg",
        url: `${SITE}/books/piranesi%20%26%20co`,
        progressPercent: 47,
        startedOn: "2026-05-01",
      },
    ]);
  });

  it("derives progressPercent from a page reference using book.pages", () => {
    const out = buildShowcase({
      ...EMPTY,
      reading: [book({ slug: "a", title: "A", status: "reading", progress: "p. 125", pages: 250 })],
    });
    expect(out.nowReading[0].progressPercent).toBe(50);
  });

  it("yields null progressPercent when the progress prose is unparseable", () => {
    const out = buildShowcase({
      ...EMPTY,
      reading: [book({ slug: "a", title: "A", status: "reading", progress: "nearly done" })],
    });
    expect(out.nowReading[0].progressPercent).toBeNull();
  });

  it("yields null cover and null startedOn when absent", () => {
    const out = buildShowcase({
      ...EMPTY,
      reading: [book({ slug: "a", title: "A", status: "reading" })],
    });
    expect(out.nowReading[0].cover).toBeNull();
    expect(out.nowReading[0].startedOn).toBeNull();
  });

  it("joins multiple authors into a single string", () => {
    const out = buildShowcase({
      ...EMPTY,
      reading: [book({ slug: "a", title: "A", status: "reading", authors: ["Ann", "Jeff"] })],
    });
    expect(out.nowReading[0].author).toBe("Ann, Jeff");
  });

  it("sorts most-recent-first by activity anchor (last_progress, then started)", () => {
    const out = buildShowcase({
      ...EMPTY,
      reading: [
        book({ slug: "old", title: "Old", status: "reading", last_progress: "2026-01-01" }),
        book({ slug: "new", title: "New", status: "reading", last_progress: "2026-05-01" }),
        book({ slug: "mid", title: "Mid", status: "reading", started: "2026-03-01" }),
      ],
    });
    expect(out.nowReading.map((b) => b.title)).toEqual(["New", "Mid", "Old"]);
  });
});

describe("buildShowcase — recentlyFinished", () => {
  it("maps the contract fields with an integer rating", () => {
    const out = buildShowcase({
      ...EMPTY,
      recentlyFinished: [
        book({
          slug: "spin",
          title: "Spin",
          authors: ["Robert Charles Wilson"],
          status: "finished",
          rating: 4,
          finished: "2026-04-20",
          cover: "https://covers.example/s.jpg",
        }),
      ],
    });
    expect(out.recentlyFinished).toEqual([
      {
        title: "Spin",
        author: "Robert Charles Wilson",
        cover: "https://covers.example/s.jpg",
        url: `${SITE}/books/spin`,
        rating: 4,
        finishedOn: "2026-04-20",
      },
    ]);
  });

  it("rounds and clamps a fractional rating into the 1-5 integer range", () => {
    const out = buildShowcase({
      ...EMPTY,
      recentlyFinished: [
        book({ slug: "a", title: "A", status: "finished", rating: 4.5 }),
        book({ slug: "b", title: "B", status: "finished", rating: 3.2 }),
      ],
    });
    expect(out.recentlyFinished[0].rating).toBe(5);
    expect(out.recentlyFinished[1].rating).toBe(3);
  });

  it("yields null rating when unrated", () => {
    const out = buildShowcase({
      ...EMPTY,
      recentlyFinished: [book({ slug: "a", title: "A", status: "finished", rating: null })],
    });
    expect(out.recentlyFinished[0].rating).toBeNull();
  });

  it("caps the list at five even if handed more", () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      book({ slug: `b${i}`, title: `B${i}`, status: "finished", finished: `2026-0${i + 1}-01` }),
    );
    const out = buildShowcase({ ...EMPTY, recentlyFinished: six });
    expect(out.recentlyFinished).toHaveLength(5);
  });
});

describe("buildShowcase — bingo", () => {
  const sq = (over: Partial<BingoSquare> & { id: string }): BingoSquare => ({
    title: null,
    authors: [],
    book: null,
    cover: null,
    done: false,
    reading: false,
    free: false,
    ...over,
  });

  it("summarises filled/total and emits a {title, author, done} square per fillable cell", () => {
    const out = buildShowcase({
      ...EMPTY,
      bingo: bingo({
        year: 2026,
        freeSquare: "center",
        squares: [
          sq({ id: "a1", title: "Ra", authors: ["qntm"], book: "Ra", done: true }),
          sq({ id: "a2", title: "Piranesi", authors: ["Susanna Clarke"], reading: true }),
          sq({ id: "free", free: true }),
          sq({ id: "a3", title: "Good Omens", authors: ["Terry Pratchett", "Neil Gaiman"] }),
        ],
      }),
    });
    expect(out.bingo).toEqual({
      year: 2026,
      filled: 1,
      total: 3,
      url: `${SITE}/#bingo`,
      squares: [
        { title: "Ra", author: "qntm", done: true },
        { title: "Piranesi", author: "Susanna Clarke", done: false },
        { title: "Good Omens", author: "Terry Pratchett, Neil Gaiman", done: false },
      ],
    });
  });

  it("excludes the free centre, preserves reading order, and keeps filled = done count", () => {
    const out = buildShowcase({
      ...EMPTY,
      bingo: bingo({
        year: 2026,
        freeSquare: "center",
        squares: [
          sq({ id: "a1", title: "One", done: true }),
          sq({ id: "a2", title: "Two" }),
          sq({ id: "c3", free: true }),
          sq({ id: "a3", title: "Three", done: true }),
        ],
      }),
    });
    expect(out.bingo?.squares.map((s) => s.title)).toEqual(["One", "Two", "Three"]);
    expect(out.bingo?.squares).toHaveLength(out.bingo!.total);
    expect(out.bingo?.squares.filter((s) => s.done)).toHaveLength(out.bingo!.filled);
  });

  it("renders a missing title/author as empty strings", () => {
    const out = buildShowcase({
      ...EMPTY,
      bingo: bingo({ year: 2026, freeSquare: null, squares: [sq({ id: "a1" })] }),
    });
    expect(out.bingo?.squares).toEqual([{ title: "", author: "", done: false }]);
  });

  it("is null when no card exists", () => {
    expect(buildShowcase(EMPTY).bingo).toBeNull();
  });
});

describe("buildShowcase — stats", () => {
  it("reports the books-this-year count", () => {
    expect(buildShowcase({ ...EMPTY, booksThisYear: 12 }).stats).toEqual({ booksThisYear: 12 });
  });
});
