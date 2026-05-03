import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import matter from "gray-matter";
import type {
  Book,
  BookStatus,
  BingoCard,
  BingoSquare,
  LogEntry,
  Pullquote,
  Tbr,
  TbrEntry,
  TbrPile,
} from "./types";

const execFileAsync = promisify(execFile);

const META_DIR = "_meta";

function booksDir(): string {
  const dir = process.env.BOOKS_DIR;
  if (dir) return dir;
  // Production (Vercel) default: the prebuild script clones vhata/books here.
  return path.join(process.cwd(), ".vault");
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
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
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

function parsePullquote(value: unknown): Pullquote | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text : null;
  if (!text) return null;
  return { text, source: typeof obj.source === "string" ? obj.source : null };
}

async function gitLastEdited(repoDir: string, file: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%cs", "--", path.relative(repoDir, file)],
      { cwd: repoDir },
    );
    const date = stdout.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
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

  const [hasReview, hasQuotes, hasSummary, lastEdited] = await Promise.all([
    fileExists(path.join(dir, "review.md")),
    fileExists(path.join(dir, "quotes.md")),
    fileExists(path.join(dir, "summary.md")),
    gitLastEdited(booksDir(), refFile),
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
    cover: parseNullableString(data.cover),
    pullquote: parsePullquote(data.pullquote),
    seeAlso: parseStringList(data.see_also),
    lastEdited,
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

export type ViewOpts = { editor?: boolean };

export async function getCurrentlyReading(opts: ViewOpts = {}): Promise<Book[]> {
  const all = await getAllBooks();
  return all.filter((b) => b.status === "reading" && isPublicVisible(b, opts));
}

export async function getRecentlyFinished(limit = 5, opts: ViewOpts = {}): Promise<Book[]> {
  const all = await getAllBooks();
  return all
    .filter((b) => b.status === "finished" && isPublicVisible(b, opts))
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

  // Look up which books are currently being read so the bingo can render
  // a "now" pill on those squares.
  const allBooks = await getAllBooks();
  const readingSlugs = new Set(allBooks.filter((b) => b.status === "reading").map((b) => b.slug));

  const squares = Array.isArray(data.squares)
    ? (data.squares as Array<Record<string, unknown>>).map((s): BingoSquare => {
        const book = typeof s.book === "string" && s.book.length > 0 ? s.book : null;
        return {
          id: typeof s.id === "string" ? s.id : "",
          title: typeof s.title === "string" ? s.title : null,
          authors: parseStringList(s.authors),
          book,
          cover: typeof s.cover === "string" ? s.cover : null,
          done: s.done === true,
          reading: book !== null && readingSlugs.has(book),
          free: s.free === true,
        };
      })
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

export function isPublicVisible(book: Book, opts: ViewOpts = {}): boolean {
  if (book.public) return true;
  if (opts.editor) return true;
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.OOK_SHOW_PRIVATE === "1") return true;
  return false;
}

export async function getTbr(): Promise<Tbr | null> {
  const file = path.join(booksDir(), META_DIR, "tbr.md");
  if (!(await fileExists(file))) return null;

  const raw = await fs.readFile(file, "utf8");
  const { data, content } = matter(raw);
  const trimmed = content.trim();

  return {
    title: typeof data.title === "string" ? data.title : "To Be Read",
    updated: parseNullableString(data.updated),
    body: trimmed,
    piles: parseTbrPiles(trimmed),
  };
}

// Parse the markdown body into typed sub-piles. Each `## Heading` starts a
// new pile; bullets `- **Title** — Author. *Why...*` become entries.
// Prose between the heading and the first bullet is captured as the pile's
// `intro`. Headings that aren't recognised pile names are still parsed.
function parseTbrPiles(body: string): TbrPile[] {
  const lines = body.split("\n");
  const piles: TbrPile[] = [];
  let current: TbrPile | null = null;
  let introBuf: string[] = [];
  let sawBullet = false;

  const flushIntro = () => {
    if (!current) return;
    if (introBuf.length === 0) return;
    const text = introBuf.join("\n").trim();
    if (text.length > 0 && !current.intro) current.intro = text;
    introBuf = [];
  };

  for (const line of lines) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      if (current) {
        flushIntro();
        piles.push(current);
      }
      current = { name: h2[1], intro: null, entries: [] };
      introBuf = [];
      sawBullet = false;
      continue;
    }
    if (!current) continue;
    const bullet = /^-\s+(.+?)\s*$/.exec(line);
    if (bullet) {
      flushIntro();
      sawBullet = true;
      const entry = parseTbrEntry(bullet[1]);
      if (entry) current.entries.push(entry);
      continue;
    }
    if (!sawBullet) {
      // Capture intro prose lines that fall between the heading and the
      // first bullet. Skip empty lines at the top.
      if (line.trim() !== "" || introBuf.length > 0) introBuf.push(line);
    }
  }
  if (current) {
    flushIntro();
    piles.push(current);
  }
  return piles;
}

function parseTbrEntry(text: string): TbrEntry | null {
  // Pattern: **Title** — Author. *why text* or **Title** — Author.
  // Title is required; author and why are optional. Accepts both *italic*
  // and _italic_ markers (prettier rewrites markdown italics to underscores).
  const titleMatch = /^\*\*(.+?)\*\*(.*)$/.exec(text);
  if (!titleMatch) return null;
  const title = titleMatch[1].trim();
  let rest = titleMatch[2].trim().replace(/^[\s—–-]+/, "");

  let why: string | null = null;
  const whyMatch = /([*_])([^*_]+)\1/.exec(rest);
  if (whyMatch) {
    why = whyMatch[2].trim();
    rest = (rest.slice(0, whyMatch.index) + rest.slice(whyMatch.index + whyMatch[0].length)).trim();
  }

  const author = rest.replace(/[\s.]+$/, "").trim() || null;

  let added: string | null = null;
  const addedMatch = /\((\d{4}-\d{2}-\d{2})\)/.exec(text);
  if (addedMatch) added = addedMatch[1];

  return { title, author, why, added };
}

// Reading log derived from book frontmatter dates. Returns most-recent first.
// Each book with a `started` date emits a "started" entry; with `finished`,
// a "finished" entry. Future: merge with manual entries from _meta/log.md.
export async function getReadingLog(limit?: number, opts: ViewOpts = {}): Promise<LogEntry[]> {
  const books = await getAllBooks();
  const visible = books.filter((b) => isPublicVisible(b, opts));
  const entries: LogEntry[] = [];
  for (const b of visible) {
    if (b.started) {
      entries.push({
        date: b.started,
        kind: "started",
        slug: b.slug,
        title: b.title,
        detail: b.authors.join(", "),
      });
    }
    if (b.finished) {
      entries.push({
        date: b.finished,
        kind: "finished",
        slug: b.slug,
        title: b.title,
        detail: b.authors.join(", "),
      });
    }
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return typeof limit === "number" ? entries.slice(0, limit) : entries;
}
