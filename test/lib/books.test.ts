import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  externalLinks,
  findBingoYearForBook,
  getAllBingoCards,
  getAllBooks,
  getBingo,
  getBingoYears,
  getBookBySlug,
  getCurrentBingoYear,
  getCurrentlyReading,
  getReadingLog,
  getRecentlyFinished,
  getStatsYears,
  getTbr,
  getYearStats,
} from "../../src/lib/books";
import type { Book } from "../../src/lib/types";

const FIXTURE_VAULT = path.resolve(__dirname, "..", "fixtures", "vault");

beforeEach(() => {
  vi.stubEnv("BOOKS_DIR", FIXTURE_VAULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAllBooks", () => {
  it("finds book directories and skips _meta and dotfiles", async () => {
    const books = await getAllBooks();
    const slugs = books.map((b) => b.slug).sort();
    expect(slugs).toEqual(["PrivateBook", "TestBook"]);
  });

  it("parses frontmatter into typed fields", async () => {
    const books = await getAllBooks();
    const test = books.find((b) => b.slug === "TestBook");
    expect(test).toBeDefined();
    expect(test?.title).toBe("Test Book");
    expect(test?.authors).toEqual(["Author One", "Author Two"]);
    expect(test?.status).toBe("finished");
    expect(test?.rating).toBe(4.5);
    expect(test?.wouldReread).toBe(true);
    expect(test?.bingoSquares).toEqual(["a1"]);
    expect(test?.tags).toEqual(["scifi", "test"]);
    expect(test?.cover).toBe("covers/test-book.svg");
    expect(test?.pullquote).toEqual({ text: "A short, memorable line.", source: "Ch. 5" });
    expect(test?.seeAlso).toEqual(["PrivateBook"]);
    expect(test?.hasReview).toBe(true);
    expect(test?.hasQuotes).toBe(true);
    expect(test?.hasSummary).toBe(false);
  });

  it("coerces a numeric goodreads_id to a string and reads other external IDs", async () => {
    const books = await getAllBooks();
    const test = books.find((b) => b.slug === "TestBook");
    expect(test?.goodreadsId).toBe("12345");
    expect(test?.hardcoverSlug).toBe("test-book");
    expect(test?.storygraphSlug).toBe("test-book-sg");
    expect(test?.bookwyrmUrl).toBe("https://bookwyrm.social/book/9001/test-book");

    const priv = books.find((b) => b.slug === "PrivateBook");
    expect(priv?.goodreadsId).toBeNull();
    expect(priv?.hardcoverSlug).toBeNull();
  });
});

describe("getCurrentlyReading", () => {
  it("returns books with status: reading", async () => {
    const reading = await getCurrentlyReading();
    expect(reading.map((b) => b.slug)).toEqual(["PrivateBook"]);
  });
});

describe("getRecentlyFinished", () => {
  it("returns finished books sorted by finished date desc", async () => {
    const finished = await getRecentlyFinished(5);
    expect(finished.map((b) => b.slug)).toEqual(["TestBook"]);
  });
});

describe("getBookBySlug", () => {
  it("returns the book with body, review, and quotes", async () => {
    const page = await getBookBySlug("TestBook");
    expect(page).not.toBeNull();
    expect(page?.book.title).toBe("Test Book");
    expect(page?.body).toContain("Some body text here.");
    expect(page?.body).not.toContain("---");
    expect(page?.review).toBe("A short review goes here.");
    expect(page?.quotes).toContain("> A favourite quote.");
  });

  it("returns null body extras when files don't exist", async () => {
    const page = await getBookBySlug("PrivateBook");
    expect(page).not.toBeNull();
    expect(page?.review).toBeNull();
    expect(page?.quotes).toBeNull();
  });

  it("returns null for unknown slugs", async () => {
    const page = await getBookBySlug("DoesNotExist");
    expect(page).toBeNull();
  });
});

describe("getBingo", () => {
  it("parses bingo card frontmatter and squares", async () => {
    const card = await getBingo(2026);
    expect(card).not.toBeNull();
    expect(card?.year).toBe(2026);
    expect(card?.size).toBe(3);
    expect(card?.freeSquare).toBe("center");
    expect(card?.squares).toHaveLength(9);

    const free = card?.squares.find((s) => s.free);
    expect(free?.id).toBe("b2");

    const claimed = card?.squares.find((s) => s.id === "a1");
    expect(claimed?.book).toBe("TestBook");
    expect(claimed?.done).toBe(true);
  });

  it("returns null for non-existent year", async () => {
    const card = await getBingo(2099);
    expect(card).toBeNull();
  });
});

describe("multi-year bingo helpers", () => {
  it("getBingoYears returns all years on disk, descending", async () => {
    const years = await getBingoYears();
    expect(years).toEqual([2026, 2025]);
  });

  it("getCurrentBingoYear is the most recent year on disk", async () => {
    expect(await getCurrentBingoYear()).toBe(2026);
  });

  it("getAllBingoCards loads every card", async () => {
    const cards = await getAllBingoCards();
    expect(cards.map((c) => c.year).sort()).toEqual([2025, 2026]);
  });

  it("findBingoYearForBook attributes a book to its card year", async () => {
    expect(await findBingoYearForBook("TestBook")).toBe(2026);
    expect(await findBingoYearForBook("PrivateBook")).toBe(2025);
    expect(await findBingoYearForBook("DoesNotExist")).toBeNull();
  });
});

describe("getTbr", () => {
  it("loads frontmatter and the markdown body", async () => {
    const tbr = await getTbr();
    expect(tbr).not.toBeNull();
    expect(tbr?.title).toBe("To Be Read");
    expect(tbr?.updated).toBe("2026-04-01");
    expect(tbr?.body).toContain("## Wanted");
    expect(tbr?.body).toContain("Old Favourite");
  });

  it("parses the body into named sub-piles with entries", async () => {
    const tbr = await getTbr();
    expect(tbr?.piles.map((p) => p.name)).toEqual(["Wanted", "Re-Read Aspirations"]);

    const wanted = tbr?.piles.find((p) => p.name === "Wanted");
    expect(wanted?.entries).toHaveLength(2);
    expect(wanted?.entries[0]).toMatchObject({
      title: "Some Wanted Book",
      author: "Some Author",
      why: "Heard about it on the podcast.",
    });
    expect(wanted?.entries[1]).toMatchObject({
      title: "Another One",
      author: "Another Author",
    });

    const reread = tbr?.piles.find((p) => p.name === "Re-Read Aspirations");
    expect(reread?.intro).toContain("happily revisit");
    expect(reread?.entries[0]).toMatchObject({
      title: "Old Favourite",
      author: "Old Author",
      why: "Want to map the world this time.",
    });
  });
});

describe("getReadingLog", () => {
  it("derives entries from book started/finished dates, newest first", async () => {
    const log = await getReadingLog();
    // TestBook: started 2026-01-15, finished 2026-02-20 → both entries
    // PrivateBook: started 2026-04-01, no finished → started entry only
    const dates = log.map((e) => `${e.date}/${e.kind}`);
    expect(dates).toContain("2026-01-15/started");
    expect(dates).toContain("2026-02-20/finished");
    expect(dates).toContain("2026-04-01/started");
    // Newest first
    expect(dates[0]).toBe("2026-04-01/started");
  });

  it("respects limit", async () => {
    const log = await getReadingLog(2);
    expect(log).toHaveLength(2);
  });
});

describe("externalLinks", () => {
  function makeBook(overrides: Partial<Book> = {}): Book {
    return {
      slug: "x",
      title: "x",
      authors: [],
      series: null,
      status: "tbr",
      progress: "",
      started: null,
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
      goodreadsId: null,
      hardcoverSlug: null,
      storygraphSlug: null,
      bookwyrmUrl: null,
      ...overrides,
    };
  }

  it("returns nothing when no IDs are populated", () => {
    expect(externalLinks(makeBook())).toEqual([]);
  });

  it("includes only the links a book actually has", () => {
    const links = externalLinks(makeBook({ goodreadsId: "12345", storygraphSlug: "dune" }));
    expect(links).toEqual([
      { label: "Goodreads", url: "https://www.goodreads.com/book/show/12345" },
      { label: "Storygraph", url: "https://app.thestorygraph.com/books/dune" },
    ]);
  });

  it("uses the Bookwyrm URL verbatim (per-instance)", () => {
    const links = externalLinks(makeBook({ bookwyrmUrl: "https://bookwyrm.social/book/42/dune" }));
    expect(links).toEqual([{ label: "Bookwyrm", url: "https://bookwyrm.social/book/42/dune" }]);
  });

  it("orders Goodreads, Hardcover, Storygraph, Bookwyrm", () => {
    const links = externalLinks(
      makeBook({
        goodreadsId: "1",
        hardcoverSlug: "h",
        storygraphSlug: "s",
        bookwyrmUrl: "https://bw.example/book/1",
      }),
    );
    expect(links.map((l) => l.label)).toEqual(["Goodreads", "Hardcover", "Storygraph", "Bookwyrm"]);
  });
});

describe("getStatsYears", () => {
  it("returns descending years that have any started or finished date", async () => {
    // TestBook started 2026-01-15, finished 2026-02-20. PrivateBook started 2026-04-01.
    const years = await getStatsYears();
    expect(years).toEqual([2026]);
  });
});

describe("getYearStats", () => {
  it("aggregates counts and averages for the given year", async () => {
    const stats = await getYearStats(2026);
    // TestBook is the only finished book in 2026 (rating 4.5).
    expect(stats.finished).toBe(1);
    expect(stats.abandoned).toBe(0);
    // TestBook started 2026; PrivateBook started 2026 → both count.
    expect(stats.startedInYear).toBe(2);
    expect(stats.rated).toBe(1);
    expect(stats.averageRating).toBeCloseTo(4.5, 5);
    expect(stats.wouldReread).toBe(1);
  });

  it("rounds half-star ratings into the nearest histogram bucket", async () => {
    const stats = await getYearStats(2026);
    // 4.5 rounds to 5.
    const five = stats.ratingDistribution.find((b) => b.rating === 5);
    expect(five?.count).toBe(1);
    const buckets = stats.ratingDistribution.map((b) => b.rating);
    expect(buckets).toEqual([5, 4, 3, 2, 1]);
  });

  it("returns top tags and authors sorted by count", async () => {
    const stats = await getYearStats(2026);
    expect(stats.topTags.map((t) => t.tag)).toEqual(["scifi", "test"]);
    expect(stats.topAuthors.map((a) => a.author).sort()).toEqual(["Author One", "Author Two"]);
  });

  it("returns empty stats for a year with no activity", async () => {
    const stats = await getYearStats(1999);
    expect(stats.finished).toBe(0);
    expect(stats.abandoned).toBe(0);
    expect(stats.startedInYear).toBe(0);
    expect(stats.averageRating).toBeNull();
    expect(stats.topTags).toEqual([]);
    expect(stats.topAuthors).toEqual([]);
  });
});

describe("YAML date frontmatter", () => {
  it("parses bare YAML dates into YYYY-MM-DD strings", async () => {
    const books = await getAllBooks();
    const test = books.find((b) => b.slug === "TestBook");
    expect(test?.started).toBe("2026-01-15");
    expect(test?.finished).toBe("2026-02-20");
  });
});
