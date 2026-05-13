import { describe, expect, it } from "vitest";
import {
  pickQuestions,
  pullquoteCandidates,
  type BackfillKind,
} from "../../src/lib/admin/backfill";
import type { Book } from "../../src/lib/types";

// Builder for a Book with sensible defaults — tests override only the
// fields they care about. Mirrors the projection shape in books.ts.
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
    ...partial,
  };
}

// Deterministic RNG for stable test ordering. Returns 0 every call so
// the Fisher–Yates shuffle is a no-op (preserves source order) — that
// way assertions can be about which kinds got picked, not which random
// books within each kind.
const stableRng = () => 0;

describe("pickQuestions", () => {
  it("includes a rate question for a finished book without a rating", () => {
    const books = [book({ slug: "a", title: "Aaa", status: "finished", rating: null })];
    const result = pickQuestions(books, 3, stableRng);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "rate", bookSlug: "a", bookTitle: "Aaa" });
    expect(result[0].prompt).toContain("rate Aaa");
  });

  it("includes a review question for a 4-star finished book without a review", () => {
    const books = [
      book({
        slug: "b",
        title: "Bbb",
        status: "finished",
        rating: 4,
        hasReview: false,
      }),
    ];
    const result = pickQuestions(books, 3, stableRng);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "review", bookSlug: "b", bookTitle: "Bbb" });
    expect(result[0].prompt).toContain("4-star");
  });

  it("includes a wouldReread question for a 5-star finished book where wouldReread is null", () => {
    const books = [
      book({
        slug: "c",
        title: "Ccc",
        status: "finished",
        rating: 5,
        hasReview: true, // suppresses the review-kind candidate so the test isolates wouldReread
        wouldReread: null,
      }),
    ];
    const result = pickQuestions(books, 3, stableRng);
    expect(result.map((r) => r.kind)).toContain("wouldReread");
    const ww = result.find((r) => r.kind === "wouldReread")!;
    expect(ww.bookSlug).toBe("c");
    expect(ww.prompt).toContain("re-read Ccc");
  });

  it("returns at most `count` questions even when more candidates exist", () => {
    const books = Array.from({ length: 12 }, (_, i) =>
      book({ slug: `s${i}`, title: `Book ${i}`, status: "finished", rating: null }),
    );
    const result = pickQuestions(books, 3, stableRng);
    expect(result).toHaveLength(3);
  });

  it("returns at most as many questions as candidates when the pool is smaller", () => {
    const books = [book({ slug: "a", title: "Aaa", status: "finished", rating: null })];
    const result = pickQuestions(books, 5, stableRng);
    expect(result).toHaveLength(1);
  });

  it("interleaves kinds rather than draining a single pool", () => {
    // 4 review-candidates, 4 rate-candidates. With round-robin, the
    // first four results should alternate between the two kinds, not
    // all be the same.
    const books = [
      ...Array.from({ length: 4 }, (_, i) =>
        book({
          slug: `r${i}`,
          title: `R${i}`,
          status: "finished",
          rating: 4,
          hasReview: false,
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        book({ slug: `n${i}`, title: `N${i}`, status: "finished", rating: null }),
      ),
    ];
    const result = pickQuestions(books, 4, stableRng);
    const kinds = result.map((r) => r.kind);
    const uniq = new Set(kinds);
    expect(uniq.size).toBeGreaterThan(1);
  });

  it("dedupes by slug so the same book doesn't appear twice in one visit", () => {
    // A 5-star with no review and no wouldReread would qualify for
    // both `review` AND `wouldReread`. We should only ever surface it
    // once per visit.
    const books = [
      book({
        slug: "dup",
        title: "Dup",
        status: "finished",
        rating: 5,
        hasReview: false,
        wouldReread: null,
      }),
    ];
    const result = pickQuestions(books, 5, stableRng);
    const slugs = result.map((r) => r.bookSlug);
    expect(slugs).toEqual(["dup"]); // exactly one entry
  });

  it("never surfaces a non-finished book", () => {
    const books: Book[] = [
      book({ slug: "tbr", title: "T", status: "tbr" }),
      book({ slug: "reading", title: "R", status: "reading" }),
      book({ slug: "abandoned", title: "A", status: "abandoned" }),
      book({ slug: "paused", title: "P", status: "paused" }),
    ];
    const result = pickQuestions(books, 5, stableRng);
    expect(result).toHaveLength(0);
  });

  it("never asks to review a finished book rated below 4", () => {
    const books = [
      book({
        slug: "low",
        title: "Low",
        status: "finished",
        rating: 3,
        hasReview: false,
      }),
    ];
    const result = pickQuestions(books, 3, stableRng);
    // The book gets no review prompt (rating < 4); it also already has
    // a rating, so the rate-kind doesn't fire either. Net: empty.
    expect(result.filter((r) => r.kind === "review")).toHaveLength(0);
  });

  it("skips review prompts when the book already has a review", () => {
    const books = [
      book({
        slug: "haveReview",
        title: "Have",
        status: "finished",
        rating: 5,
        hasReview: true,
        wouldReread: true, // also block wouldReread so result is empty
      }),
    ];
    const result = pickQuestions(books, 3, stableRng);
    expect(result).toHaveLength(0);
  });

  it("returns empty when the corpus is empty", () => {
    expect(pickQuestions([], 3, stableRng)).toEqual([]);
  });

  it("returns 3 questions of the right kinds for the mixed-fixture brief", () => {
    // Brief case: a book with no rating; a book with rating=4 and no
    // review.md; a book with rating=5 and wouldReread=null.
    const books: Book[] = [
      book({ slug: "norating", title: "NoRating", status: "finished", rating: null }),
      book({
        slug: "noreview",
        title: "NoReview",
        status: "finished",
        rating: 4,
        hasReview: false,
      }),
      book({
        slug: "noreread",
        title: "NoReread",
        status: "finished",
        rating: 5,
        hasReview: true,
        wouldReread: null,
      }),
    ];
    const result = pickQuestions(books, 3, stableRng);
    expect(result).toHaveLength(3);
    const kinds = new Set<BackfillKind>(result.map((r) => r.kind));
    expect(kinds.has("rate")).toBe(true);
    expect(kinds.has("review")).toBe(true);
    expect(kinds.has("wouldReread")).toBe(true);
  });

  it("dedupes by slug — a 5-star finished book missing both review AND wouldReread gets one card", () => {
    // Round-robin interleaves review → rate → wouldReread, so the
    // first hit for this slug is `review` (it's first in pool order),
    // and the slug-dedupe blocks the later `wouldReread` candidate.
    const books = [
      book({
        slug: "both",
        title: "Both",
        status: "finished",
        rating: 5,
        hasReview: false,
        wouldReread: null,
      }),
    ];
    const result = pickQuestions(books, 5, stableRng);
    const slugs = result.map((r) => r.bookSlug);
    expect(slugs).toEqual(["both"]);
    expect(result[0].kind).toBe("review");
  });
});

describe("pullquoteCandidates", () => {
  const SAMPLE_QUOTES = `# Quotes

> The Beauty of the House is immeasurable; its Kindness infinite.

— Opening line

> Another reasonably-long passage that ends with a clear terminal mark.
`;

  function fakeReader(map: Record<string, string>): (slug: string) => Promise<string | null> {
    return async (slug) => map[slug] ?? null;
  }

  it("returns one candidate per qualifying book with scored quotes", async () => {
    const books = [
      book({
        slug: "piranesi",
        title: "Piranesi",
        status: "finished",
        hasQuotes: true,
        pullquote: null,
      }),
    ];
    const out = await pullquoteCandidates(books, fakeReader({ piranesi: SAMPLE_QUOTES }));
    expect(out).toHaveLength(1);
    const q = out[0];
    expect(q.kind).toBe("pullquote");
    expect(q.bookSlug).toBe("piranesi");
    expect(q.candidates).toBeDefined();
    expect((q.candidates ?? []).length).toBeGreaterThan(0);
    expect((q.candidates ?? [])[0].text).toContain("Beauty of the House");
  });

  it("skips books that already have a pullquote", async () => {
    const books = [
      book({
        slug: "piranesi",
        title: "Piranesi",
        status: "finished",
        hasQuotes: true,
        pullquote: { text: "Already set", source: null },
      }),
    ];
    const out = await pullquoteCandidates(books, fakeReader({ piranesi: SAMPLE_QUOTES }));
    expect(out).toEqual([]);
  });

  it("skips books without quotes.md (hasQuotes: false)", async () => {
    const books = [
      book({
        slug: "piranesi",
        title: "Piranesi",
        status: "finished",
        hasQuotes: false,
        pullquote: null,
      }),
    ];
    const out = await pullquoteCandidates(books, fakeReader({}));
    expect(out).toEqual([]);
  });

  it("skips non-finished books", async () => {
    const books = [
      book({
        slug: "piranesi",
        title: "Piranesi",
        status: "reading",
        hasQuotes: true,
        pullquote: null,
      }),
    ];
    const out = await pullquoteCandidates(books, fakeReader({ piranesi: SAMPLE_QUOTES }));
    expect(out).toEqual([]);
  });

  it("skips books whose quotes.md has no scorable lines (all too short)", async () => {
    const books = [
      book({
        slug: "tiny",
        title: "Tiny",
        status: "finished",
        hasQuotes: true,
        pullquote: null,
      }),
    ];
    const out = await pullquoteCandidates(books, fakeReader({ tiny: "> brief.\n\n> hi." }));
    expect(out).toEqual([]);
  });
});

describe("pickQuestions — pullquote interleave", () => {
  it("interleaves the pullquote pool ahead of the other kinds", () => {
    const books = [
      book({
        slug: "rateMe",
        title: "RateMe",
        status: "finished",
        rating: null,
      }),
    ];
    const pullquotePool = [
      {
        kind: "pullquote" as const,
        bookSlug: "piranesi",
        bookTitle: "Piranesi",
        bookAuthors: ["Susanna Clarke"],
        bookCover: null,
        prompt: "...",
        candidates: [
          {
            text: "The Beauty of the House is immeasurable; its Kindness infinite.",
            source: "Opening line",
            score: 100,
          },
        ],
      },
    ];
    const result = pickQuestions(books, 2, stableRng, pullquotePool);
    // Pullquote leads the round-robin.
    expect(result[0].kind).toBe("pullquote");
    expect(result[0].bookSlug).toBe("piranesi");
  });
});
