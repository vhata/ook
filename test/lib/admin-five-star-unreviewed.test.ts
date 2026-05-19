import { describe, expect, it } from "vitest";
import { fiveStarUnreviewed, pickOne } from "../../src/lib/admin/five-star-unreviewed";
import type { Book } from "../../src/lib/types";

// Builder for a Book with sensible defaults — mirrors the shape used
// by `test/lib/admin-backfill.test.ts`. Tests override only the fields
// they care about.
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

describe("fiveStarUnreviewed — candidate filter", () => {
  it("picks finished + rating=5 + no review.md", () => {
    const books = [
      book({ slug: "a", title: "A", status: "finished", rating: 5, hasReview: false }),
    ];
    const result = fiveStarUnreviewed(books);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ slug: "a", title: "A", authors: ["Author"], cover: null });
  });

  it("skips books that already have a review.md", () => {
    const books = [
      book({ slug: "rev", title: "R", status: "finished", rating: 5, hasReview: true }),
    ];
    expect(fiveStarUnreviewed(books)).toEqual([]);
  });

  it("skips books rated below 5", () => {
    const books = [
      book({ slug: "four", title: "F", status: "finished", rating: 4, hasReview: false }),
      book({ slug: "three", title: "T", status: "finished", rating: 3, hasReview: false }),
      book({ slug: "none", title: "N", status: "finished", rating: null, hasReview: false }),
    ];
    expect(fiveStarUnreviewed(books)).toEqual([]);
  });

  it("skips non-finished books even when rated 5 and unreviewed", () => {
    const statuses: Array<Book["status"]> = ["tbr", "reading", "abandoned", "paused"];
    const books = statuses.map((status, i) =>
      book({ slug: `s${i}`, title: `S${i}`, status, rating: 5, hasReview: false }),
    );
    expect(fiveStarUnreviewed(books)).toEqual([]);
  });

  it("returns one entry per qualifying book, preserving corpus order", () => {
    const books = [
      book({ slug: "first", title: "First", status: "finished", rating: 5, hasReview: false }),
      book({ slug: "skip", title: "Skip", status: "finished", rating: 5, hasReview: true }),
      book({ slug: "second", title: "Second", status: "finished", rating: 5, hasReview: false }),
    ];
    const result = fiveStarUnreviewed(books);
    expect(result.map((c) => c.slug)).toEqual(["first", "second"]);
  });

  it("carries the public-catalog fields (slug, title, authors, cover) — nothing private", () => {
    const books = [
      book({
        slug: "piranesi",
        title: "Piranesi",
        authors: ["Susanna Clarke"],
        cover: "https://example/cover.jpg",
        status: "finished",
        rating: 5,
        hasReview: false,
        // Field that should NOT leak — `progress` is tier-2 content.
        progress: "secret reading notes",
      }),
    ];
    const result = fiveStarUnreviewed(books);
    expect(result[0]).toEqual({
      slug: "piranesi",
      title: "Piranesi",
      authors: ["Susanna Clarke"],
      cover: "https://example/cover.jpg",
    });
    expect((result[0] as unknown as Record<string, unknown>).progress).toBeUndefined();
  });

  it("returns empty for an empty corpus", () => {
    expect(fiveStarUnreviewed([])).toEqual([]);
  });
});

describe("pickOne — session-tracking semantics", () => {
  const POOL = [
    { slug: "a", title: "A", authors: ["A"], cover: null },
    { slug: "b", title: "B", authors: ["B"], cover: null },
    { slug: "c", title: "C", authors: ["C"], cover: null },
  ];

  it("returns the first candidate when no exclusion set is given", () => {
    expect(pickOne(POOL)).toEqual(POOL[0]);
  });

  it("skips any candidate whose slug is in the exclusion set", () => {
    expect(pickOne(POOL, new Set(["a"]))).toEqual(POOL[1]);
    expect(pickOne(POOL, new Set(["a", "b"]))).toEqual(POOL[2]);
  });

  it("returns null when every candidate has been excluded — one ask per book per session", () => {
    expect(pickOne(POOL, new Set(["a", "b", "c"]))).toBeNull();
  });

  it("returns null on an empty pool", () => {
    expect(pickOne([], new Set())).toBeNull();
  });

  it("ordering is stable across calls — re-asking with the same exclusion set returns the same book", () => {
    const skip = new Set(["a"]);
    const first = pickOne(POOL, skip);
    const second = pickOne(POOL, skip);
    expect(first).toEqual(second);
  });

  it("session-tracking flow: each pick advances by adding its slug to the exclusion set", () => {
    const offered = new Set<string>();
    // Round 1: pick A, then "offer" it (mimicking the AdminConsole's
    // offeredSlugs state mutation).
    const round1 = pickOne(POOL, offered);
    expect(round1?.slug).toBe("a");
    offered.add(round1!.slug);
    // Round 2: A is excluded; helper returns B.
    const round2 = pickOne(POOL, offered);
    expect(round2?.slug).toBe("b");
    offered.add(round2!.slug);
    // Round 3: A + B excluded; helper returns C.
    const round3 = pickOne(POOL, offered);
    expect(round3?.slug).toBe("c");
    offered.add(round3!.slug);
    // Round 4: pool exhausted for this session.
    expect(pickOne(POOL, offered)).toBeNull();
  });
});
