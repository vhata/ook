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
  public: boolean;
  bingoSquares: string[];
  tags: string[];
  cover: string | null;
  pullquote: Pullquote | null;
  seeAlso: string[];
  lastEdited: string | null;
  hasReview: boolean;
  hasQuotes: boolean;
  hasSummary: boolean;
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
