export type BookStatus = "tbr" | "reading" | "finished" | "abandoned" | "paused";

export type Pullquote = {
  text: string;
  source: string | null;
};

export type Book = {
  slug: string;
  title: string;
  authors: string[];
  series: string | null;
  status: BookStatus;
  progress: string;
  started: string | null;
  finished: string | null;
  rating: number | null;
  wouldReread: boolean | null;
  bingoSquares: string[];
  tags: string[];
  cover: string | null;
  pullquote: Pullquote | null;
  seeAlso: string[];
  lastEdited: string | null;
  hasReview: boolean;
  hasQuotes: boolean;
  hasSummary: boolean;
  goodreadsId: string | null;
  hardcoverSlug: string | null;
  storygraphSlug: string | null;
  bookwyrmUrl: string | null;
  // Where this book record came from. "goodreads" — imported from
  // the user's Goodreads CSV (likely has personal reading history
  // attached). "media-list" — word-of-mouth recommendation. "manual"
  // — hand-built. Null means the field hasn't been backfilled yet.
  source: BookSource | null;
  // Per-book opt-out for the "What others said" Hardcover-reviews
  // disclosure on the per-book page. Set `hide_external_reviews: true`
  // in the book's YAML frontmatter to suppress the section even when
  // the cache has qualifying reviews. Defaults to false.
  hideExternalReviews: boolean;
};

export type BookSource = "goodreads" | "media-list" | "manual";

export type ExternalLink = {
  label: string;
  url: string;
};

export type BingoSquare = {
  id: string;
  title: string | null;
  authors: string[];
  book: string | null;
  cover: string | null;
  done: boolean;
  reading: boolean;
  free: boolean;
};

export type BingoCard = {
  year: number;
  title: string;
  size: number;
  freeSquare: "center" | null;
  squares: BingoSquare[];
};

export type Tbr = {
  title: string;
  updated: string | null;
  body: string;
  piles: TbrPile[];
};

export type TbrPile = {
  name: string;
  intro: string | null;
  entries: TbrEntry[];
};

export type TbrEntry = {
  title: string;
  author: string | null;
  why: string | null;
  added: string | null;
};

export type LogEntry = {
  date: string;
  kind: "started" | "finished" | "progress" | "tbr" | "note" | "reread" | "committed";
  slug: string | null;
  title: string | null;
  detail: string;
};

export type RatingBucket = {
  // Rating bucket label (1..5). Half-star ratings round to nearest whole.
  rating: number;
  count: number;
};

export type TagCount = {
  tag: string;
  count: number;
};

export type AuthorCount = {
  author: string;
  count: number;
};

export type YearStats = {
  year: number;
  finished: number;
  abandoned: number;
  startedInYear: number;
  rated: number;
  averageRating: number | null;
  ratingDistribution: RatingBucket[];
  topTags: TagCount[];
  topAuthors: AuthorCount[];
  wouldReread: number;
  // Longest finished book in the year by Hardcover-`pages`. Null when no
  // finished book in the year has a paged record in the Hardcover cache.
  longestBook: LongestBook | null;
  // Total pages finished per calendar month of the year, January (index 0)
  // through December (index 11). Always 12 entries; months with no paged
  // finishes are 0. Books missing a Hardcover `pages` value contribute
  // nothing — the chart silently degrades for incomplete cache coverage.
  pagesByMonth: number[];
};

export type LongestBook = {
  slug: string;
  title: string;
  authors: string[];
  pages: number;
};

export type SeriesMember = {
  // Book reference, kept lean — pages list only the catalog facts.
  slug: string;
  title: string;
  authors: string[];
  status: BookStatus;
  rating: number | null;
  finished: string | null;
  started: string | null;
  cover: string | null;
  // Parsed series index ("Realm of the Elderlings #3" → 3). Null when the
  // series field has no `#N` marker.
  index: number | null;
};

export type SeriesGroup = {
  name: string;
  members: SeriesMember[];
  // When this series is a sub-series of a larger one (every member
  // also belongs to the parent series and the parent has strictly
  // more members), the parent's name lives here. Tiffany Aching is
  // a sub-series of Discworld, etc. Computed at /series build time
  // from corpus relationships, not stored in vault frontmatter.
  subseriesOf?: string;
  // Integer indexes that are missing BETWEEN known members — if the
  // vault has #1, #3, and #5, this is `[2, 4]`. We never invent
  // entries before the first known index or after the last (no way
  // to know the true start/end), so this surfaces gaps the corpus
  // can prove exist.
  gaps: number[];
  // Members the roster (from `_meta/series-rosters.json`, populated
  // by `make vault-series-rosters-apply`) knows about but the vault
  // doesn't have a directory for. Includes the title + author from
  // Hardcover so the placeholder reads like a real book row.
  rosterMissing: RosterMissing[];
  // Total book count for the series according to the roster (when
  // available). Lets the header read "5 of 41 read in vault" instead
  // of "5 of 5".
  rosterCount?: number;
};

export type RosterMissing = {
  position: number | null;
  title: string;
  authors: string[];
  hardcoverSlug: string | null;
};

// Per-book metadata cached from Hardcover by goodreads_id. Populated by
// `scripts/backfill-hardcover-books.mjs`; renderer reads it for the
// "X readers · ★ Y" community signal on per-book pages. All fields nullable
// because Hardcover may not have every book and the cache may be stale.
export type HardcoverBook = {
  goodreadsId: string;
  hardcoverId: number | null;
  hardcoverSlug: string | null;
  title: string | null;
  pages: number | null;
  rating: number | null;
  ratings_count: number;
  reviews_count: number;
  users_count: number;
  users_read_count: number;
  release_year: number | null;
};

// One short, public Hardcover review surfaced on a per-book page under
// the "What others said" disclosure. Cached by
// `scripts/backfill-hardcover-reviews.mjs` at `_meta/hardcover-reviews.json`.
// Quality-filtered at fetch time (rating ≥ 3, body 80..600 chars,
// non-spoiler) and capped at the top 3 by likes_count.
export type HardcoverReview = {
  id: string;
  body: string;
  rating: number | null;
  username: string | null;
  likes: number;
  createdAt: string | null;
};

// One book may belong to multiple series — Discworld is the canonical
// case (every Witches/Watch/Tiffany Aching book is also a Discworld
// book, with its own `#N` per series). Encoded in the vault as a
// `; `-delimited string: `series: "Discworld, #32; Tiffany Aching #2"`.
export type SeriesMembership = {
  name: string;
  index: number | null;
};

export type DayActivity = {
  // ISO date string (YYYY-MM-DD).
  date: string;
  // Day of week, 0=Sun..6=Sat (UTC).
  weekday: number;
  // Total events on this date — started + finished + manual log entries.
  count: number;
};

export type ConnectionReason = {
  kind: "see-also" | "series" | "author" | "tag";
  detail: string;
};

export type TagSummary = {
  tag: string;
  count: number;
  bookSlugs: string[];
  // Top co-occurring tags (limited to 3) — "if you click this tag, you
  // tend to also see these alongside it".
  coOccurring: Array<{ tag: string; count: number }>;
};

export type Connection = {
  a: { slug: string; title: string; authors: string[]; cover: string | null };
  b: { slug: string; title: string; authors: string[]; cover: string | null };
  score: number;
  reasons: ConnectionReason[];
};
