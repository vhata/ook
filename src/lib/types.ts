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
  // Most recent date the reader logged progress on this book (YYYY-MM-DD).
  // Drives the render-time auto-promotion to `paused`: a reading book
  // with no progress for > 90 days renders as paused even when the
  // frontmatter still says `status: reading`. Distinct from `started`
  // (the date the reader first opened the book) and `finished` (the
  // date it ended). Null when never logged — falls back to `started`
  // for the effective-status threshold check.
  last_progress: string | null;
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
  // True when `<slug>/progress.md` exists. The running-notes file the
  // reader writes WHILE reading — a memory aid for the next pick-up.
  // Tier-2 content (folded into the deep-notes endpoint payload), not
  // rendered on the per-book page directly. Archived to
  // `_meta/progress-archive/<slug>.md` when the book finishes.
  hasProgress: boolean;
  // Tier-0 back-cover-style prose, always rendered on the per-book
  // page when present. A sentence or two in non-spoiler register;
  // populated automatically from the Hardcover description cache by
  // `scripts/backfill-premises.mjs`. Null when the cache lookup hasn't
  // happened yet or the cache record carries no description.
  premise: string | null;
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
  // Literal bullet text from the source markdown (everything after the
  // `- ` marker, with trailing whitespace trimmed). The real parser
  // always sets this; write-back paths (remove-bullet patches against
  // `_meta/triage.md` / `_meta/tbr.md`) replay it verbatim so the
  // bullet matches the on-disk text character-for-character.
  // Reconstructing the bullet from the structured fields doesn't
  // round-trip cleanly for every shape (e.g. the `#N` series-index
  // prefix the parser folds into the author field). Optional in the
  // type so test fixtures can omit it; production code always has it.
  raw?: string;
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
  // Sum of Hardcover `pages` across every finished book in the year that
  // has a paged Hardcover record. Null when zero finished books in the
  // year have such a record — the Topline tile degrades silently in that
  // case, mirroring `longestBook`.
  totalPages: number | null;
  // Coverage of the totalPages number: how many finished books in the
  // year had a paged Hardcover record, out of the total number of
  // finished books in the year. Lets the Topline tile show
  // "from N of M books with page data" so the user knows when the sum
  // under-counts.
  pagesCoverage: { withPages: number; total: number };
  // End-of-year pace projection, populated only when the viewed year is
  // the current calendar year, we're at least ~30 days in, and at least
  // three books have been finished so far. `booksAtCurrentRate` is the
  // year-end total if today's pace holds (`round(F / D * Y)`);
  // `currentRate` is the finish rate (books per day-of-year) used to
  // derive it. Null when any precondition fails — past years, sparse
  // early-year data, the final day of the year, etc.
  paceProjection: { booksAtCurrentRate: number; currentRate: number } | null;
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
  // by `make vault-series-rosters`) knows about but the vault
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
