import type { BingoCard, BingoSquare, Book } from "./types";

// Time-machine lens. Filters / re-derives data shapes against a target
// date so the home page can render "as of" that date.
//
// Semantics, deliberately approximate:
//   - A book is currently-reading at D iff started <= D AND (finished
//     is null OR finished > D).
//   - A book is finished at D iff finished is set AND finished <= D.
//   - Bingo done-ness flips when the bound book's finished <= D.
//
// This works against the *current* frontmatter — the source of truth
// for what dates things happened. It does NOT rewind the vault git
// history (a more accurate but much heavier path; revisit only if the
// approximation feels wrong). Books added to the vault after D will
// still appear in the index; they just won't pass the date filters.

export type TimeMachine = {
  // ISO YYYY-MM-DD that drives the lens.
  at: string;
};

export function makeTimeMachine(input: string): TimeMachine | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  // Sanity-check the date parses.
  const ms = Date.parse(`${input}T12:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return { at: input };
}

// True if this book counts as currently-reading at the lens date.
export function isReadingAt(book: Book, at: string): boolean {
  if (!book.started) return false;
  if (book.started > at) return false;
  if (book.finished && book.finished <= at) return false;
  // status === "abandoned"/"paused" today doesn't reach back — treat
  // as still-reading at D unless they've been explicitly finished.
  return true;
}

export function isFinishedAt(book: Book, at: string): boolean {
  return book.finished !== null && book.finished <= at;
}

export function readingAt(books: Book[], at: string): Book[] {
  return books.filter((b) => isReadingAt(b, at));
}

export function finishedAt(books: Book[], at: string, limit?: number): Book[] {
  const out = books
    .filter((b) => isFinishedAt(b, at))
    .sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? ""));
  return limit !== undefined ? out.slice(0, limit) : out;
}

// Re-project a bingo card so done/reading flags reflect the lens date.
// `bookBySlug` lets us look up the bound book without re-fetching.
export function bingoAt(card: BingoCard, at: string, bookBySlug: Map<string, Book>): BingoCard {
  const squares: BingoSquare[] = card.squares.map((sq) => {
    if (!sq.book) return sq;
    const linked = bookBySlug.get(sq.book);
    if (!linked) return sq;
    return {
      ...sq,
      done: isFinishedAt(linked, at),
      reading: isReadingAt(linked, at),
    };
  });
  return { ...card, squares };
}
