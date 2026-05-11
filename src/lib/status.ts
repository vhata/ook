import type { Book, BookStatus } from "./types";

// Render-time auto-promotion from `reading` to `paused`. The vault's
// stored status is what the reader explicitly wrote; the effective
// status is what the page actually shows. A book whose reader hasn't
// touched it in three months is misleadingly framed as "Now reading"
// — this helper draws the line.
//
// Threshold table:
//
//   stored   days since last_progress   effective
//   ------   ------------------------   ---------
//   reading  < 14                       reading      (fresh)
//   reading  14..90                     reading      (no glow but on /now)
//   reading  > 90 or undefined          paused       (auto-promoted)
//   paused   (any)                      paused       (user-set wins)
//   tbr      (any)                      tbr
//   finished (any)                      finished
//   abandoned (any)                     abandoned
//
// When `last_progress` is undefined we fall back to `started` so books
// the reader opened but never logged a progress note for still get the
// threshold applied. When both are undefined a reading book auto-
// promotes immediately — no fence-post effect, since the only way a
// book reaches "reading" without either field is a fresh import that
// hasn't been touched on the site at all.
//
// `today` is injected so render-time use and unit tests share one
// time source. The threshold is computed in UTC days to match the
// rest of the codebase's date handling (started/finished are stored
// as YYYY-MM-DD without a timezone).

const FRESH_DAYS = 14;
const PAUSE_DAYS = 90;
const DAY_MS = 86400000;

export type EffectiveStatusInput = {
  status: BookStatus;
  last_progress: string | null | undefined;
  started?: string | null;
};

// Whole-day count between two YYYY-MM-DD anchors in UTC, with `today`
// derived from a Date instance. Negative results clamp to 0 (a future
// anchor shouldn't read as "negative days quiet").
function daysBetween(anchor: string, today: Date): number | null {
  const anchorMs = Date.parse(`${anchor}T00:00:00Z`);
  if (!Number.isFinite(anchorMs)) return null;
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((todayMs - anchorMs) / DAY_MS));
}

export function effectiveStatus(
  status: BookStatus,
  last_progress: string | null | undefined,
  today: Date,
  started?: string | null,
): BookStatus {
  // User-set values that aren't `reading` pass through. Explicit
  // `paused` wins over the timer; explicit `abandoned` / `finished` /
  // `tbr` are never auto-promoted.
  if (status !== "reading") return status;

  // For a `reading` book, fall through to the threshold check using
  // `last_progress` (preferred) or `started` (fallback) as the anchor.
  const anchor = last_progress ?? started ?? null;
  if (!anchor) return "paused";

  const daysSince = daysBetween(anchor, today);
  if (daysSince === null) return status;

  if (daysSince > PAUSE_DAYS) return "paused";
  return "reading";
}

// True for "fresh" reading books — within FRESH_DAYS of last progress.
// Used by the renderer to decide whether to show the accent glow vs a
// quieter card. Returns false for any non-reading status, and for
// reading books without progress (treat as not-fresh — they're stale
// by definition).
export function isFreshReading(
  status: BookStatus,
  last_progress: string | null | undefined,
  today: Date,
  started?: string | null,
): boolean {
  if (status !== "reading") return false;
  const anchor = last_progress ?? started ?? null;
  if (!anchor) return false;
  const daysSince = daysBetween(anchor, today);
  if (daysSince === null) return false;
  return daysSince < FRESH_DAYS;
}

// Split a list of books into the two sections /now renders: actively
// reading vs paused/set-aside. A book lands in `paused` if either its
// stored status is "paused" or its `reading` status auto-promotes via
// the threshold rule. Books with any other stored status are dropped.
// Reading list ordering preserves input order; paused list orders by
// most-recently-active first (longer-untouched cards sink).
export function splitNowBooks(books: Book[], today: Date): { reading: Book[]; paused: Book[] } {
  const reading: Book[] = [];
  const paused: Book[] = [];
  for (const book of books) {
    if (book.status !== "reading" && book.status !== "paused") continue;
    const eff = effectiveStatus(book.status, book.last_progress, today, book.started);
    if (eff === "reading") reading.push(book);
    else if (eff === "paused") paused.push(book);
  }
  paused.sort((a, b) => {
    const aDays = daysSinceLastProgress(a.last_progress, today, a.started) ?? Infinity;
    const bDays = daysSinceLastProgress(b.last_progress, today, b.started) ?? Infinity;
    return aDays - bDays;
  });
  return { reading, paused };
}

// Days since the last_progress anchor (or `started` fallback), for the
// "X days ago" indicator on paused cards. Null when no anchor exists.
export function daysSinceLastProgress(
  last_progress: string | null | undefined,
  today: Date,
  started?: string | null,
): number | null {
  const anchor = last_progress ?? started ?? null;
  if (!anchor) return null;
  return daysBetween(anchor, today);
}
