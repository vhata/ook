import { describe, expect, it } from "vitest";
import { pickQuestions, type BackfillKind } from "../../src/lib/admin/backfill";
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
    hasSummary: false,
    premise: null,
    goodreadsId: null,
    hardcoverSlug: null,
    storygraphSlug: null,
    bookwyrmUrl: null,
    source: null,
    hideExternalReviews: false,
    ...partial,
  };
}

// Deterministic RNG for stable test ordering. Returns 0 every call so
// the Fisher–Yates shuffle is a no-op (preserves source order) — that
// way assertions can be about which kinds got picked, not which random
// books within each kind.
const stableRng = () => 0;

// Helper: a book builder that defaults `premise` to a non-empty value
// so the premise-candidate pool stays out of the way of tests pinning
// other kinds. Tests that want to exercise the premise pool override
// `premise: null` explicitly.
function bookWithPremise(partial: Partial<Book> & { slug: string; title: string }): Book {
  return book({
    premise: "An always-set blurb so this book isn't a premise candidate.",
    ...partial,
  });
}

describe("pickQuestions", () => {
  it("includes a rate question for a finished book without a rating", () => {
    const books = [bookWithPremise({ slug: "a", title: "Aaa", status: "finished", rating: null })];
    const result = pickQuestions(books, 3, stableRng);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "rate", bookSlug: "a", bookTitle: "Aaa" });
    expect(result[0].prompt).toContain("rate Aaa");
  });

  it("includes a review question for a 4-star finished book without a review", () => {
    const books = [
      bookWithPremise({
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
      bookWithPremise({
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
      bookWithPremise({
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
    // review.md; a book with rating=5 and wouldReread=null. All three
    // have premise set so the premise pool doesn't compete with the
    // kinds the test pins.
    const books: Book[] = [
      bookWithPremise({ slug: "norating", title: "NoRating", status: "finished", rating: null }),
      bookWithPremise({
        slug: "noreview",
        title: "NoReview",
        status: "finished",
        rating: 4,
        hasReview: false,
      }),
      bookWithPremise({
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

  // Premise candidate behaviour. The brief: prompt finished books with
  // no premise set, status-blind for renderer purposes but keep the
  // backfill surface to finished-only so we don't conflict with the
  // queued start-prompt pattern for tbr → reading transitions.

  it("fires a premise card for a finished book with no premise", () => {
    const books = [
      book({
        slug: "needsPremise",
        title: "NeedsPremise",
        status: "finished",
        rating: 4,
        hasReview: true, // block review-kind so we isolate premise
        wouldReread: true, // block wouldReread
        premise: null,
      }),
    ];
    const result = pickQuestions(books, 3, stableRng);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "premise", bookSlug: "needsPremise" });
    expect(result[0].prompt.toLowerCase()).toContain("back-cover");
  });

  it("treats a whitespace-only premise as missing and offers the card", () => {
    // gray-matter sometimes round-trips an empty value as "" or "  "
    // rather than dropping the key — both shapes must qualify as
    // "no premise" so the question still fires.
    const books = [
      book({
        slug: "emptyPremise",
        title: "EmptyPremise",
        status: "finished",
        rating: 4,
        hasReview: true,
        wouldReread: true,
        premise: "   ",
      }),
    ];
    const result = pickQuestions(books, 3, stableRng);
    expect(result.map((r) => r.kind)).toContain("premise");
  });

  it("does not fire a premise card when the book already has a premise", () => {
    const books = [
      book({
        slug: "hasPremise",
        title: "HasPremise",
        status: "finished",
        rating: 4,
        hasReview: true,
        wouldReread: true,
        premise: "A retired engineer wakes up on a strange island.",
      }),
    ];
    const result = pickQuestions(books, 3, stableRng);
    expect(result).toHaveLength(0);
  });

  it("does not fire a premise card on tbr / reading / abandoned books", () => {
    // The backfill surface is finished-only; the renderer is the
    // status-blind half of the contract.
    const books: Book[] = [
      book({ slug: "tbr", title: "T", status: "tbr", premise: null }),
      book({ slug: "reading", title: "R", status: "reading", premise: null }),
      book({ slug: "abandoned", title: "A", status: "abandoned", premise: null }),
    ];
    const result = pickQuestions(books, 5, stableRng);
    expect(result.filter((r) => r.kind === "premise")).toHaveLength(0);
  });

  it("dedupes by slug — a book missing both rating AND premise gets just one card", () => {
    // Round-robin interleaves review → premise → rate → wouldReread,
    // so the first hit for this slug is `premise` (review pool empty),
    // and the slug-dedupe blocks the later `rate` candidate.
    const books = [
      book({
        slug: "both",
        title: "Both",
        status: "finished",
        rating: null,
        hasReview: true,
        wouldReread: true,
        premise: null,
      }),
    ];
    const result = pickQuestions(books, 5, stableRng);
    const slugs = result.map((r) => r.bookSlug);
    expect(slugs).toEqual(["both"]);
  });
});
