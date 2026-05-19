// Boolean AND filter over the tag axis: books that carry both of two
// named tags. Used by /tags/[tag]?and=<other> to surface the
// intersection behind the "Strongest pairings" drill-in.
//
// Pure derivation over the existing corpus shape — accepts any object
// with a `tags: string[]` field so tests can pass minimal fixtures
// without minting full `Book` records. The route call site passes the
// `Book[]` it already has from `getAllBooks()` / `getBooksByTag()`.
//
// Tag-matching is exact-equality on strings: the index page normalises
// tags on the way in, and the rest of the renderer treats them as
// opaque strings. Casing matters; the URL receives the encoded raw
// tag.
//
// The empty-result and missing-tag cases both return `[]` — the route
// distinguishes the two by checking the corpus first (the parent tag
// has its own /tags/[tag] 404 path; the AND-view inherits that and
// renders an empty section under the existing header).

import type { Book } from "@/lib/types";

export function intersectBooksByTags<T extends Pick<Book, "tags">>(
  books: T[],
  a: string,
  b: string,
): T[] {
  // Same-tag AND degenerates to single-tag (the URL shouldn't produce
  // this in practice, but the helper stays robust): just filter on
  // membership of `a` once.
  if (a === b) return books.filter((book) => book.tags.includes(a));
  return books.filter((book) => book.tags.includes(a) && book.tags.includes(b));
}
