import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  externalLinks,
  findBingoYearForBook,
  getBooksByTag,
  getConnections,
  getTagIndex,
  getAllBingoCards,
  getAllBooks,
  getAllSeries,
  getBingo,
  getBingoYears,
  getBookBySlug,
  getCurrentBingoYear,
  getCurrentlyReading,
  getManualLogEntries,
  getOnThisDay,
  getReadingLog,
  getRecentlyFinished,
  getStatsYears,
  getTbr,
  getYearActivity,
  getYearStats,
  parseSeriesField,
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
    expect(claimed?.reading).toBe(false);
  });

  it("derives done from the linked book's status, ignoring the YAML field", async () => {
    // bingo-2025 a2: book=PrivateBook (status: reading), but YAML says
    // `done: true`. Derived value must win — the linked book is not
    // finished, so the square is not done.
    const card = await getBingo(2025);
    const a2 = card?.squares.find((s) => s.id === "a2");
    expect(a2?.book).toBe("PrivateBook");
    expect(a2?.done).toBe(false);
    expect(a2?.reading).toBe(true);
  });

  it("treats unbound squares as not-done regardless of YAML", async () => {
    const card = await getBingo(2026);
    const unbound = card?.squares.find((s) => s.id === "a3");
    expect(unbound?.book).toBeNull();
    expect(unbound?.done).toBe(false);
    expect(unbound?.reading).toBe(false);
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
    // Newest first across frontmatter + manual entries.
    expect(dates[0]).toBe("2026-04-15/committed");
  });

  it("respects limit", async () => {
    const log = await getReadingLog(2);
    expect(log).toHaveLength(2);
  });
});

describe("getManualLogEntries", () => {
  it("parses date headings and bold-prefix bullets into typed entries", async () => {
    const entries = await getManualLogEntries();
    const summary = entries.map((e) => `${e.date}/${e.kind}`);
    expect(summary).toEqual([
      "2026-04-15/committed",
      "2026-04-15/tbr",
      "2026-03-22/note",
      "2026-03-22/reread",
      "2026-02-10/progress",
      "2026-02-10/note", // fallback for unrecognised prefix
    ]);
    // Manual entries carry no slug/title — the detail is the prose.
    expect(entries.every((e) => e.slug === null && e.title === null)).toBe(true);
    expect(entries[0].detail).toContain("24 books named");
  });

  it("merges with frontmatter-derived log entries in date order", async () => {
    const log = await getReadingLog();
    // 2026-04-15 entries (manual) sit above 2026-04-01 (PrivateBook started).
    const firstFiveDates = log.slice(0, 5).map((e) => e.date);
    expect(firstFiveDates).toEqual([
      "2026-04-15",
      "2026-04-15",
      "2026-04-01",
      "2026-03-22",
      "2026-03-22",
    ]);
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

describe("parseSeriesField", () => {
  it("extracts name and integer index", () => {
    expect(parseSeriesField("Realm of the Elderlings #3")).toEqual({
      name: "Realm of the Elderlings",
      index: 3,
    });
  });

  it("accepts decimal indices for novellas", () => {
    expect(parseSeriesField("Mistborn #1.5")).toEqual({ name: "Mistborn", index: 1.5 });
  });

  it("returns a null index when no #N marker is present", () => {
    expect(parseSeriesField("The Library at Mount Char")).toEqual({
      name: "The Library at Mount Char",
      index: null,
    });
  });

  it("trims whitespace around the name", () => {
    expect(parseSeriesField("  Hyperion Cantos  #2  ")).toEqual({
      name: "Hyperion Cantos",
      index: 2,
    });
  });
});

describe("getAllSeries", () => {
  it("groups books with a series field", async () => {
    const series = await getAllSeries();
    expect(series.map((s) => s.name)).toEqual(["Test Series"]);
    const ts = series[0];
    expect(ts.members).toHaveLength(1);
    expect(ts.members[0].slug).toBe("TestBook");
    expect(ts.members[0].index).toBe(1);
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

describe("getTagIndex", () => {
  it("returns each tag with count and co-occurring tags, sorted by count desc", async () => {
    const tags = await getTagIndex();
    // TestBook has tags [scifi, test]; PrivateBook has []. Both tags appear once.
    const summary = tags.map((t) => ({ tag: t.tag, count: t.count }));
    expect(summary).toEqual(
      expect.arrayContaining([
        { tag: "scifi", count: 1 },
        { tag: "test", count: 1 },
      ]),
    );
    const scifi = tags.find((t) => t.tag === "scifi");
    expect(scifi?.bookSlugs).toEqual(["TestBook"]);
    expect(scifi?.coOccurring.map((c) => c.tag)).toEqual(["test"]);
  });
});

describe("getBooksByTag", () => {
  it("returns books that carry the tag, finish-date desc", async () => {
    const books = await getBooksByTag("scifi");
    expect(books.map((b) => b.slug)).toEqual(["TestBook"]);
  });

  it("returns an empty array for an unknown tag", async () => {
    expect(await getBooksByTag("unknown-tag")).toEqual([]);
  });
});

describe("getConnections", () => {
  it("connects TestBook and PrivateBook via the see-also link", async () => {
    // TestBook lists `see_also: [PrivateBook]`. PrivateBook is reading,
    // TestBook is finished — both are in the pool, so they should pair.
    const conns = await getConnections();
    expect(conns).toHaveLength(1);
    const c = conns[0];
    const slugs = [c.a.slug, c.b.slug].sort();
    expect(slugs).toEqual(["PrivateBook", "TestBook"]);
    expect(c.reasons.some((r) => r.kind === "see-also")).toBe(true);
    expect(c.score).toBeGreaterThan(0);
  });
});

describe("getOnThisDay", () => {
  it("returns past-year entries that match today's MM-DD", async () => {
    // Pretend it's 2027-02-20: TestBook finished 2026-02-20 should match.
    const today = new Date("2027-02-20T12:00:00Z");
    const entries = await getOnThisDay(today);
    const slugs = entries.map((e) => `${e.date}/${e.kind}`);
    expect(slugs).toContain("2026-02-20/finished");
  });

  it("excludes current-year matches (those are not 'past')", async () => {
    const today = new Date("2026-02-20T12:00:00Z");
    const entries = await getOnThisDay(today);
    expect(entries).toHaveLength(0);
  });

  it("returns nothing when no past-year matches exist", async () => {
    const today = new Date("2027-07-04T12:00:00Z");
    const entries = await getOnThisDay(today);
    expect(entries).toEqual([]);
  });
});

describe("getYearActivity", () => {
  it("returns one entry per day of the year with event counts", async () => {
    const days = await getYearActivity(2026);
    // 2026 is not a leap year — 365 days.
    expect(days).toHaveLength(365);
    expect(days[0].date).toBe("2026-01-01");
    expect(days[days.length - 1].date).toBe("2026-12-31");

    // TestBook started 2026-01-15 + manual log "2026-04-15" has 2 entries =
    // those days should be > 0 events.
    const jan15 = days.find((d) => d.date === "2026-01-15");
    expect(jan15?.count).toBe(1);
    const apr15 = days.find((d) => d.date === "2026-04-15");
    expect(apr15?.count).toBe(2);
    // 2026-02-20: TestBook finished. 1 event.
    const feb20 = days.find((d) => d.date === "2026-02-20");
    expect(feb20?.count).toBe(1);
  });

  it("returns 366 days for a leap year", async () => {
    const days = await getYearActivity(2028);
    expect(days).toHaveLength(366);
  });

  it("tags every day with its weekday (0 = Sunday, UTC)", async () => {
    const days = await getYearActivity(2026);
    // 2026-01-01 was a Thursday → weekday = 4.
    expect(days[0].weekday).toBe(4);
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
