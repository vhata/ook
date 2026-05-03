export type BookStatus =
  | "tbr"
  | "reading"
  | "finished"
  | "abandoned"
  | "paused";

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
  hasReview: boolean;
  hasQuotes: boolean;
  hasSummary: boolean;
};

export type BingoSquare = {
  id: string;
  label: string;
  book: string | null;
  free: boolean;
};

export type BingoCard = {
  year: number;
  title: string;
  size: number;
  freeSquare: "center" | null;
  squares: BingoSquare[];
};
