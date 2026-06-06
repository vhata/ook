import type { Book } from "./types";

// Books credited to a given author, most-recent first by finished date
// (falling back to started), then title ascending, with undated books
// trailing the dated ones — so an author page leads with what you've read
// most recently and lets the unread tail sort by title. Close to
// getBooksByTag's ordering, but dated-before-undated is enforced here
// because an author list mixes read and unread more than a tag list does.
// Pure — the async accessor that feeds it the corpus lives in books.ts as
// getBooksByAuthor. Match is exact against each book's `authors` entries,
// so a multi-author book surfaces under each of its authors.
export function booksByAuthor(books: Book[], author: string): Book[] {
  return books
    .filter((b) => b.authors.includes(author))
    .sort((a, b) => {
      const ad = a.finished ?? a.started ?? "";
      const bd = b.finished ?? b.started ?? "";
      if (ad && bd && ad !== bd) return bd.localeCompare(ad);
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return a.title.localeCompare(b.title);
    });
}
