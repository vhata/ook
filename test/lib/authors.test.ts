import { describe, expect, it } from "vitest";
import { booksByAuthor } from "../../src/lib/authors";
import type { Book } from "../../src/lib/types";

// Pure filter+sort behind the /authors/[author] drill-in. Mirrors the
// ordering of getBooksByTag (most-recent-by-finished/started first, then
// title) so a per-author list reads the same way a per-tag list does.

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

describe("booksByAuthor", () => {
  it("returns only books whose authors include the exact name", () => {
    const books = [
      book({ slug: "a", title: "A", authors: ["Terry Pratchett"] }),
      book({ slug: "b", title: "B", authors: ["Neil Gaiman"] }),
      book({ slug: "c", title: "C", authors: ["Terry Pratchett", "Neil Gaiman"] }),
    ];
    expect(booksByAuthor(books, "Terry Pratchett").map((b) => b.slug)).toEqual(["a", "c"]);
  });

  it("matches a co-author on a multi-author book", () => {
    const books = [
      book({
        slug: "good-omens",
        title: "Good Omens",
        authors: ["Terry Pratchett", "Neil Gaiman"],
      }),
    ];
    expect(booksByAuthor(books, "Neil Gaiman").map((b) => b.slug)).toEqual(["good-omens"]);
  });

  it("sorts most-recent first by finished, falling back to started", () => {
    const books = [
      book({ slug: "old", title: "Old", authors: ["X"], finished: "2020-01-01" }),
      book({ slug: "new", title: "New", authors: ["X"], finished: "2026-05-01" }),
      book({ slug: "started-only", title: "Started", authors: ["X"], started: "2026-03-01" }),
    ];
    expect(booksByAuthor(books, "X").map((b) => b.slug)).toEqual(["new", "started-only", "old"]);
  });

  it("breaks date ties by title ascending; undated books sort after dated", () => {
    const books = [
      book({ slug: "z", title: "Zed", authors: ["X"] }),
      book({ slug: "a", title: "Apple", authors: ["X"] }),
      book({ slug: "d", title: "Dated", authors: ["X"], finished: "2024-01-01" }),
    ];
    expect(booksByAuthor(books, "X").map((b) => b.slug)).toEqual(["d", "a", "z"]);
  });

  it("returns an empty array when no book has the author", () => {
    expect(booksByAuthor([book({ slug: "a", title: "A", authors: ["Y"] })], "Z")).toEqual([]);
  });
});
