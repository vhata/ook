// Public showcase payload behind `GET /api/showcase.json`.
//
// Consumed server-side by the owner's personal site (vhata.net), which
// features "what I'm reading" sourced from ook rather than scraping
// Goodreads. The output shape is a CONTRACT: vhata depends on these exact
// field names. Adding fields later is safe; renaming or removing one needs
// coordination with that site.
//
// Everything here is already public on ook — no auth, no secrets. The
// transform is split in two:
//   - `buildShowcase` is a pure shaping function (tested directly).
//   - `getShowcase` wires the real vault accessors into it, reusing the
//     same helpers the `/now`, home, and stats surfaces already use rather
//     than re-deriving currently-reading / finished / bingo / year-count.

import {
  getBingo,
  getCurrentBingoYear,
  getCurrentlyReading,
  getRecentlyFinished,
  getYearStats,
} from "./books";
import { parseProgress } from "./progress-parse";
import { SITE_URL } from "./site";
import type { BingoCard, Book } from "./types";

export type ShowcaseNowReading = {
  title: string;
  author: string;
  cover: string | null;
  url: string;
  progressPercent: number | null;
  startedOn: string | null;
};

export type ShowcaseFinished = {
  title: string;
  author: string;
  cover: string | null;
  url: string;
  rating: number | null;
  finishedOn: string | null;
};

export type ShowcaseBingoSquare = {
  title: string;
  author: string;
  done: boolean;
};

export type ShowcaseBingo = {
  year: number;
  filled: number;
  total: number;
  url: string;
  // One entry per fillable square (the free centre excluded), in the
  // card's reading order — left-to-right, top-to-bottom. `squares.length`
  // equals `total`, and the count of `done: true` equals `filled`. ook's
  // squares are designated books, so each carries the book's title +
  // author rather than a challenge-prompt theme; the consumer decides how
  // to present them.
  squares: ShowcaseBingoSquare[];
};

export type Showcase = {
  nowReading: ShowcaseNowReading[];
  recentlyFinished: ShowcaseFinished[];
  bingo: ShowcaseBingo | null;
  stats: { booksThisYear: number } | null;
  siteUrl: string;
};

export type ShowcaseInput = {
  reading: Book[];
  recentlyFinished: Book[];
  bingo: BingoCard | null;
  booksThisYear: number;
  siteUrl: string;
};

// Absolute per-book URL. Slugs can contain spaces and other characters that
// must be encoded for a valid path segment.
function bookUrl(siteUrl: string, slug: string): string {
  return `${siteUrl}/books/${encodeURIComponent(slug)}`;
}

// The vault stores authors as a list; the contract wants a single string.
// Join with a comma so co-authored books don't silently drop a name.
function authorString(authors: string[]): string {
  return authors.join(", ");
}

// Most-recent-first by activity anchor: the date the reader last touched the
// book (`last_progress`), falling back to when they started it. Books with
// neither sort last. Mirrors how `/now` orders the Reading section by recency.
function byRecencyDesc(a: Book, b: Book): number {
  const anchor = (x: Book) => x.last_progress ?? x.started ?? "";
  return anchor(b).localeCompare(anchor(a));
}

export function buildShowcase(input: ShowcaseInput): Showcase {
  const { reading, recentlyFinished, bingo, booksThisYear, siteUrl } = input;

  const nowReading: ShowcaseNowReading[] = [...reading].sort(byRecencyDesc).map((b) => ({
    title: b.title,
    author: authorString(b.authors),
    cover: b.cover,
    url: bookUrl(siteUrl, b.slug),
    progressPercent: parseProgress(b.progress, b.pages)?.percent ?? null,
    startedOn: b.started,
  }));

  const finished: ShowcaseFinished[] = recentlyFinished.slice(0, 5).map((b) => ({
    title: b.title,
    author: authorString(b.authors),
    cover: b.cover,
    url: bookUrl(siteUrl, b.slug),
    // Vault ratings are integer 1-5; round + clamp defensively in case a
    // half-star value (synced from Hardcover) ever reaches the field.
    rating: b.rating == null ? null : Math.max(1, Math.min(5, Math.round(b.rating))),
    finishedOn: b.finished,
  }));

  // Bingo progress mirrors the home page exactly: the free square counts
  // toward neither the numerator nor the denominator. Done-ness is derived
  // from the bound book's status upstream in `getBingo`.
  const fillable = bingo ? bingo.squares.filter((s) => !s.free) : [];
  const bingoOut: ShowcaseBingo | null = bingo
    ? {
        year: bingo.year,
        filled: fillable.filter((s) => s.done).length,
        total: fillable.length,
        url: `${siteUrl}/#bingo`,
        // Reading order is preserved from the card; the free centre is
        // already filtered out above. `title`/`author` come from the
        // square's designated book (null title/empty authors → "").
        squares: fillable.map((s) => ({
          title: s.title ?? "",
          author: authorString(s.authors),
          done: s.done,
        })),
      }
    : null;

  return {
    nowReading,
    recentlyFinished: finished,
    bingo: bingoOut,
    stats: { booksThisYear },
    siteUrl,
  };
}

// Async wiring: reuse the same accessors the live surfaces use. `today`
// drives both the auto-paused threshold (via `getCurrentlyReading`) and the
// "this calendar year" count, and is injectable for tests.
export async function getShowcase(today: Date = new Date()): Promise<Showcase> {
  const calendarYear = today.getFullYear();
  const [reading, recentlyFinished, bingoYear, yearStats] = await Promise.all([
    getCurrentlyReading(today),
    getRecentlyFinished(5),
    getCurrentBingoYear(),
    getYearStats(calendarYear, today),
  ]);
  const bingo = bingoYear !== null ? await getBingo(bingoYear) : null;

  return buildShowcase({
    reading,
    recentlyFinished,
    bingo,
    booksThisYear: yearStats.finished,
    siteUrl: SITE_URL,
  });
}
