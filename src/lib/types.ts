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
};

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
};
