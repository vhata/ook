// Pure helpers for the `/shelf` bookspine renderer. Kept separate from
// the page component so the width/year-boundary logic can be unit-tested
// without dragging in React or the data layer.

// Default spine width applied when a book has no `pages` frontmatter.
// Sits in the lower-middle of the clamp range so unsized spines don't
// dominate the row.
export const SPINE_FALLBACK_WIDTH = 32;

// Hard floors and ceilings for the page-count → width mapping. The
// formula is `clamp(MIN, round(pages / DIVISOR), MAX)` — a 300-page
// book lands near 25 px, a 600-page book near 50 px, a 900-page book
// near the ceiling. Real shelves vary wildly; uniform widths look
// web-y.
export const SPINE_MIN_WIDTH = 24;
export const SPINE_MAX_WIDTH = 72;
const SPINE_PAGE_DIVISOR = 12;

/** Map a page count to a spine width in pixels. */
export function computeSpineWidth(pages: number | null | undefined): number {
  if (typeof pages !== "number" || !Number.isFinite(pages) || pages <= 0) {
    return SPINE_FALLBACK_WIDTH;
  }
  const raw = Math.round(pages / SPINE_PAGE_DIVISOR);
  if (raw < SPINE_MIN_WIDTH) return SPINE_MIN_WIDTH;
  if (raw > SPINE_MAX_WIDTH) return SPINE_MAX_WIDTH;
  return raw;
}

/** Extract the four-digit year from a `YYYY-MM-DD` ISO date string. */
export function yearOfFinish(finished: string | null): number | null {
  if (typeof finished !== "string" || finished.length < 4) return null;
  const yr = Number(finished.slice(0, 4));
  return Number.isFinite(yr) ? yr : null;
}

/**
 * A row item in the shelf strip — either a spine to render, or a
 * year-boundary marker introducing a small gap and a tick label below
 * the shelf. The page component renders these in order.
 */
export type ShelfItem<TBook> =
  | { kind: "spine"; book: TBook }
  | { kind: "year-break"; year: number };

/**
 * Interleave year-break markers between spines wherever the finish
 * year changes. Books with no `finished` date (currently-reading)
 * form an "ongoing" bucket that never emits a year tick of its own;
 * the first finished book after one or more ongoing entries opens
 * the year stripe naturally. Pass `showYearBreaks: false` to skip
 * interleaving entirely — useful when the sort order isn't
 * chronological.
 */
export function buildShelfItems<TBook extends { finished: string | null }>(
  books: TBook[],
  showYearBreaks: boolean,
): ShelfItem<TBook>[] {
  if (!showYearBreaks) return books.map((book) => ({ kind: "spine", book }));
  const out: ShelfItem<TBook>[] = [];
  let prevBucket: number | "ongoing" | null = null;
  for (const book of books) {
    const finishYear = yearOfFinish(book.finished);
    const currentBucket: number | "ongoing" = finishYear ?? "ongoing";
    if (prevBucket !== null && prevBucket !== currentBucket && typeof currentBucket === "number") {
      out.push({ kind: "year-break", year: currentBucket });
    }
    out.push({ kind: "spine", book });
    prevBucket = currentBucket;
  }
  return out;
}
