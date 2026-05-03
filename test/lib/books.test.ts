import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  getAllBooks,
  getBingo,
  getBookBySlug,
  getCurrentlyReading,
  getRecentlyFinished,
  getTbr,
  isPublicVisible,
} from "../../src/lib/books";

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
    expect(test?.public).toBe(true);
    expect(test?.bingoSquares).toEqual(["a1"]);
    expect(test?.tags).toEqual(["scifi", "test"]);
    expect(test?.hasReview).toBe(true);
    expect(test?.hasQuotes).toBe(true);
    expect(test?.hasSummary).toBe(false);
  });
});

describe("getCurrentlyReading", () => {
  it("returns reading books outside production (private included)", async () => {
    const reading = await getCurrentlyReading();
    expect(reading.map((b) => b.slug)).toEqual(["PrivateBook"]);
  });

  it("hides private reading books in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OOK_SHOW_PRIVATE", "");
    const reading = await getCurrentlyReading();
    expect(reading).toEqual([]);
  });
});

describe("getRecentlyFinished", () => {
  it("returns finished books sorted by finished date desc", async () => {
    const finished = await getRecentlyFinished(5);
    expect(finished.map((b) => b.slug)).toEqual(["TestBook"]);
  });

  it("hides private finished books in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OOK_SHOW_PRIVATE", "");
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

describe("getTbr", () => {
  it("loads frontmatter and the markdown body", async () => {
    const tbr = await getTbr();
    expect(tbr).not.toBeNull();
    expect(tbr?.title).toBe("To Be Read");
    expect(tbr?.updated).toBe("2026-04-01");
    expect(tbr?.body).toContain("## Wanted");
    expect(tbr?.body).toContain("Old Favourite");
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

describe("isPublicVisible", () => {
  function bookWith(publicFlag: boolean) {
    return { public: publicFlag } as Parameters<typeof isPublicVisible>[0];
  }

  it("public books are always visible", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isPublicVisible(bookWith(true))).toBe(true);
  });

  it("private books are visible outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isPublicVisible(bookWith(false))).toBe(true);
  });

  it("private books are hidden in production by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OOK_SHOW_PRIVATE", "");
    expect(isPublicVisible(bookWith(false))).toBe(false);
  });

  it("OOK_SHOW_PRIVATE=1 reveals private books in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OOK_SHOW_PRIVATE", "1");
    expect(isPublicVisible(bookWith(false))).toBe(true);
  });
});
