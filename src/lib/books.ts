import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Book, BookStatus, BingoCard, BingoSquare } from "./types";

const META_DIR = "_meta";

function booksDir(): string {
  const dir = process.env.BOOKS_DIR;
  if (!dir) {
    throw new Error(
      "BOOKS_DIR environment variable is not set. Point it at your books vault directory.",
    );
  }
  return dir;
}

const VALID_STATUSES: BookStatus[] = ["tbr", "reading", "finished", "abandoned", "paused"];

function parseStatus(value: unknown): BookStatus {
  if (typeof value === "string" && (VALID_STATUSES as string[]).includes(value)) {
    return value as BookStatus;
  }
  return "tbr";
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

function parseNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseNullableBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readBookDir(slug: string): Promise<Book | null> {
  const dir = path.join(booksDir(), slug);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return null;

  const refFile = path.join(dir, `${slug}.md`);
  if (!(await fileExists(refFile))) return null;

  const raw = await fs.readFile(refFile, "utf8");
  const { data } = matter(raw);

  const [hasReview, hasQuotes, hasSummary] = await Promise.all([
    fileExists(path.join(dir, "review.md")),
    fileExists(path.join(dir, "quotes.md")),
    fileExists(path.join(dir, "summary.md")),
  ]);

  return {
    slug,
    title: typeof data.title === "string" ? data.title : slug,
    authors: parseStringList(data.authors),
    series: parseNullableString(data.series),
    status: parseStatus(data.status),
    progress: typeof data.progress === "string" ? data.progress : "",
    started: parseNullableString(data.started),
    finished: parseNullableString(data.finished),
    rating: parseNullableNumber(data.rating),
    wouldReread: parseNullableBoolean(data.would_reread),
    public: data.public === true,
    bingoSquares: parseStringList(data.bingo_squares),
    tags: parseStringList(data.tags),
    hasReview,
    hasQuotes,
    hasSummary,
  };
}

export async function getAllBooks(): Promise<Book[]> {
  const entries = await fs.readdir(booksDir(), { withFileTypes: true });
  const slugs = entries
    .filter((e) => e.isDirectory() && e.name !== META_DIR && !e.name.startsWith("."))
    .map((e) => e.name);

  const books = await Promise.all(slugs.map(readBookDir));
  return books.filter((b): b is Book => b !== null);
}

export async function getCurrentlyReading(): Promise<Book[]> {
  const all = await getAllBooks();
  return all.filter((b) => b.status === "reading");
}

export async function getRecentlyFinished(limit = 5): Promise<Book[]> {
  const all = await getAllBooks();
  return all
    .filter((b) => b.status === "finished")
    .sort((a, b) => {
      const aDate = a.finished ?? "0000-00-00";
      const bDate = b.finished ?? "0000-00-00";
      return bDate.localeCompare(aDate);
    })
    .slice(0, limit);
}

export async function getBingo(year: number): Promise<BingoCard | null> {
  const file = path.join(booksDir(), META_DIR, `bingo-${year}.md`);
  if (!(await fileExists(file))) return null;

  const raw = await fs.readFile(file, "utf8");
  const { data } = matter(raw);

  const squares = Array.isArray(data.squares)
    ? (data.squares as Array<Record<string, unknown>>).map(
        (s): BingoSquare => ({
          id: typeof s.id === "string" ? s.id : "",
          title: typeof s.title === "string" ? s.title : null,
          authors: parseStringList(s.authors),
          book: typeof s.book === "string" && s.book.length > 0 ? s.book : null,
          done: s.done === true,
          free: s.free === true,
        }),
      )
    : [];

  return {
    year: typeof data.year === "number" ? data.year : year,
    title: typeof data.title === "string" ? data.title : `Bingo ${year}`,
    size: typeof data.size === "number" ? data.size : 5,
    freeSquare: data.free_square === "center" ? "center" : null,
    squares,
  };
}

export type BookPage = {
  book: Book;
  body: string;
  review: string | null;
  quotes: string | null;
};

export async function getBookBySlug(slug: string): Promise<BookPage | null> {
  const dir = path.join(booksDir(), slug);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return null;

  const refFile = path.join(dir, `${slug}.md`);
  if (!(await fileExists(refFile))) return null;

  const book = await readBookDir(slug);
  if (!book) return null;

  const raw = await fs.readFile(refFile, "utf8");
  const { content } = matter(raw);

  const [review, quotes] = await Promise.all([
    readOptionalFile(path.join(dir, "review.md")),
    readOptionalFile(path.join(dir, "quotes.md")),
  ]);

  return { book, body: content.trim(), review, quotes };
}

async function readOptionalFile(p: string): Promise<string | null> {
  if (!(await fileExists(p))) return null;
  const raw = await fs.readFile(p, "utf8");
  return raw.trim();
}

export function isPublicVisible(book: Book): boolean {
  if (book.public) return true;
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.OOK_SHOW_PRIVATE === "1") return true;
  return false;
}
