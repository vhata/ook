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
  Connection,
  ConnectionReason,
  DayActivity,
  ExternalLink,
  LogEntry,
  Pullquote,
  SeriesGroup,
  SeriesMember,
  TagSummary,
  Tbr,
  TbrEntry,
  TbrPile,
  YearStats,
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

// Goodreads IDs are numeric but YAML may parse them as string or number.
// Coerce to a non-empty string; null on anything else.
function parseId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
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
    bingoSquares: parseStringList(data.bingo_squares),
    tags: parseStringList(data.tags),
    cover: parseNullableString(data.cover),
    pullquote: parsePullquote(data.pullquote),
    seeAlso: parseStringList(data.see_also),
    lastEdited,
    hasReview,
    hasQuotes,
    hasSummary,
    goodreadsId: parseId(data.goodreads_id),
    hardcoverSlug: parseNullableString(data.hardcover_slug),
    storygraphSlug: parseNullableString(data.storygraph_slug),
    bookwyrmUrl: parseNullableString(data.bookwyrm_url),
  };
}

// Build the list of outbound links the book actually has IDs for. Order is
// fixed (Goodreads, Hardcover, Storygraph, Bookwyrm); missing fields drop
// out, never guessed. Returns [] if no IDs are populated.
// "This one stuck" — books that earned the reader's full attention.
// Heuristic: a finished book that the reader both reviewed AND quoted
// AND either rated highly (≥4) or marked would-reread. Three signals,
// because any one alone is too easy to clear (a half-star rating, a
// stub review). The rule is intentionally rule-based, not corpus-
// quantile, so the badge's meaning is stable as the corpus grows.
export function bookStuck(book: Book): boolean {
  if (book.status !== "finished") return false;
  if (!book.hasReview || !book.hasQuotes) return false;
  return (book.rating !== null && book.rating >= 4) || book.wouldReread === true;
}

export function externalLinks(book: Book): ExternalLink[] {
  const links: ExternalLink[] = [];
  if (book.goodreadsId) {
    links.push({
      label: "Goodreads",
      url: `https://www.goodreads.com/book/show/${book.goodreadsId}`,
    });
  }
  if (book.hardcoverSlug) {
    links.push({ label: "Hardcover", url: `https://hardcover.app/books/${book.hardcoverSlug}` });
  }
  if (book.storygraphSlug) {
    links.push({
      label: "Storygraph",
      url: `https://app.thestorygraph.com/books/${book.storygraphSlug}`,
    });
  }
  if (book.bookwyrmUrl) {
    links.push({ label: "Bookwyrm", url: book.bookwyrmUrl });
  }
  return links;
}

export async function getAllBooks(): Promise<Book[]> {
  let entries;
  try {
    entries = await fs.readdir(booksDir(), { withFileTypes: true });
  } catch {
    // Vault dir missing (e.g. fresh production deploy without the key wired
    // up yet). Return empty so the site renders an empty-state instead of 500.
    return [];
  }
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

// List the years for which a bingo file exists, descending. Source of truth
// for "what cards are there" — pages call this (or `getCurrentBingoYear`)
// rather than hardcoding a year.
export async function getBingoYears(): Promise<number[]> {
  const dir = path.join(booksDir(), META_DIR);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const years: number[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const m = /^bingo-(\d{4})\.md$/.exec(e.name);
    if (m) years.push(Number(m[1]));
  }
  years.sort((a, b) => b - a);
  return years;
}

// Highest bingo-year on disk, or null when no card exists. The "current"
// card for the home page and bingo CTAs.
export async function getCurrentBingoYear(): Promise<number | null> {
  const years = await getBingoYears();
  return years[0] ?? null;
}

// Load every bingo card on disk. Used for per-book attribution: a book may
// claim squares on a card from a prior year, and the per-book page wants to
// surface "2025 Bingo · X" rather than mis-labelling with the current year.
export async function getAllBingoCards(): Promise<BingoCard[]> {
  const years = await getBingoYears();
  const cards = await Promise.all(years.map((y) => getBingo(y)));
  return cards.filter((c): c is BingoCard => c !== null);
}

// Find the bingo year that references a given book slug. Returns the most
// recent matching year, or null if the book is on no card.
export async function findBingoYearForBook(slug: string): Promise<number | null> {
  const cards = await getAllBingoCards();
  for (const c of cards) {
    if (c.squares.some((s) => s.book === slug)) return c.year;
  }
  return null;
}

export async function getBingo(year: number): Promise<BingoCard | null> {
  const file = path.join(booksDir(), META_DIR, `bingo-${year}.md`);
  if (!(await fileExists(file))) return null;

  const raw = await fs.readFile(file, "utf8");
  const { data } = matter(raw);

  // Look up linked books so we can: (a) render a "now" pill on currently-
  // reading squares; (b) prefer the book's own frontmatter cover over the
  // stale copy embedded in the bingo file; (c) derive done-ness from the
  // bound book's status. The bingo's cover field is the fallback for squares
  // without a vault directory.
  const allBooks = await getAllBooks();
  const bySlug = new Map(allBooks.map((b) => [b.slug, b]));

  const squares = Array.isArray(data.squares)
    ? (data.squares as Array<Record<string, unknown>>).map((s): BingoSquare => {
        const bookSlug = typeof s.book === "string" && s.book.length > 0 ? s.book : null;
        const linked = bookSlug ? bySlug.get(bookSlug) : undefined;
        const cover = linked?.cover ?? (typeof s.cover === "string" ? s.cover : null);
        return {
          id: typeof s.id === "string" ? s.id : "",
          title: typeof s.title === "string" ? s.title : null,
          authors: parseStringList(s.authors),
          book: bookSlug,
          cover,
          // Done-ness is derived from the linked book's status — single
          // source of truth per book. The square's stored `done` field is
          // ignored (and is a candidate for vault-side cleanup).
          done: linked?.status === "finished",
          reading: linked?.status === "reading",
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

// Reading log: frontmatter-derived entries (started/finished dates per
// book) merged with optional manual entries from `_meta/log.md`.
// Returns most-recent first.
export async function getReadingLog(limit?: number): Promise<LogEntry[]> {
  const [books, manual] = await Promise.all([getAllBooks(), getManualLogEntries()]);
  const entries: LogEntry[] = [];
  for (const b of books) {
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
  entries.push(...manual);
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return typeof limit === "number" ? entries.slice(0, limit) : entries;
}

// Bold-prefix → LogEntry.kind. Prefix matching is case-insensitive and
// trimmed; anything not in this table falls back to `note`. Started/
// finished are intentionally absent: those live on book frontmatter and
// must not be duplicated in the manual log.
const MANUAL_LOG_KIND_MAP: Record<string, LogEntry["kind"]> = {
  note: "note",
  progress: "progress",
  reread: "reread",
  "added to tbr": "tbr",
  tbr: "tbr",
  "committed to bingo": "committed",
  committed: "committed",
};

// Parse `_meta/log.md` (optional) into typed entries. Body shape:
//   ## YYYY-MM-DD
//   - **Note** — free text
//   - **Committed to bingo** — free text
// Entries with no date heading or unparseable bullets are skipped.
export async function getManualLogEntries(): Promise<LogEntry[]> {
  const file = path.join(booksDir(), META_DIR, "log.md");
  if (!(await fileExists(file))) return [];
  const raw = await fs.readFile(file, "utf8");
  const { content } = matter(raw);

  const entries: LogEntry[] = [];
  let currentDate: string | null = null;
  for (const line of content.split("\n")) {
    const heading = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (heading) {
      currentDate = heading[1];
      continue;
    }
    if (!currentDate) continue;
    const bullet = /^-\s+\*\*(.+?)\*\*\s*[—–-]?\s*(.*)$/.exec(line.trim());
    if (!bullet) continue;
    const prefixKey = bullet[1].trim().toLowerCase();
    const kind = MANUAL_LOG_KIND_MAP[prefixKey] ?? "note";
    const detail = bullet[2].trim();
    entries.push({ date: currentDate, kind, slug: null, title: null, detail });
  }
  return entries;
}

// Parses a series field like "Realm of the Elderlings #3" into name + index.
// Bare series names ("The Library at Mount Char") return `null` index.
// Decimal indices (#1.5 — for novellas) are accepted.
export function parseSeriesField(raw: string): { name: string; index: number | null } {
  const m = /^(.+?)\s*#(\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (m) {
    const idx = Number(m[2]);
    return { name: m[1].trim(), index: Number.isFinite(idx) ? idx : null };
  }
  return { name: raw.trim(), index: null };
}

// Group every book that has a `series` field into a series catalogue.
// Members within each series are sorted by parsed index (nulls last), then
// by finish date, then by start date — falling back to title as a tiebreak.
// Series themselves are sorted by name.
export async function getAllSeries(): Promise<SeriesGroup[]> {
  const books = await getAllBooks();
  const groups = new Map<string, SeriesMember[]>();
  for (const b of books) {
    if (!b.series) continue;
    const { name, index } = parseSeriesField(b.series);
    const member: SeriesMember = {
      slug: b.slug,
      title: b.title,
      authors: b.authors,
      status: b.status,
      rating: b.rating,
      finished: b.finished,
      started: b.started,
      cover: b.cover,
      index,
    };
    const existing = groups.get(name);
    if (existing) existing.push(member);
    else groups.set(name, [member]);
  }
  const result: SeriesGroup[] = [];
  for (const [name, members] of groups) {
    members.sort((a, b) => {
      if (a.index !== null && b.index !== null) return a.index - b.index;
      if (a.index !== null) return -1;
      if (b.index !== null) return 1;
      const aDate = a.finished ?? a.started ?? "";
      const bDate = b.finished ?? b.started ?? "";
      if (aDate && bDate) return aDate.localeCompare(bDate);
      return a.title.localeCompare(b.title);
    });
    result.push({ name, members });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// Years (descending) that have at least one book event — finished, started,
// or both. Powers the `/stats` index and any year-picker UI.
export async function getStatsYears(): Promise<number[]> {
  const books = await getAllBooks();
  const years = new Set<number>();
  for (const b of books) {
    if (b.finished) years.add(Number(b.finished.slice(0, 4)));
    if (b.started) years.add(Number(b.started.slice(0, 4)));
  }
  return [...years].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
}

// Tag taxonomy: every tag in the vault, with its book count and the top
// co-occurring tags. Powers the /tags index browse view.
export async function getTagIndex(): Promise<TagSummary[]> {
  const books = await getAllBooks();
  // count[tag] = books with that tag
  const counts = new Map<string, Set<string>>(); // tag -> set of book slugs
  // co[tag] = Map<otherTag, count>
  const co = new Map<string, Map<string, number>>();

  for (const b of books) {
    if (b.tags.length === 0) continue;
    for (const t of b.tags) {
      if (!counts.has(t)) counts.set(t, new Set());
      counts.get(t)!.add(b.slug);
      if (!co.has(t)) co.set(t, new Map());
    }
    // Pairwise co-occurrence within this book.
    for (let i = 0; i < b.tags.length; i++) {
      for (let j = 0; j < b.tags.length; j++) {
        if (i === j) continue;
        const a = b.tags[i];
        const c = b.tags[j];
        const m = co.get(a)!;
        m.set(c, (m.get(c) ?? 0) + 1);
      }
    }
  }

  const summaries: TagSummary[] = [];
  for (const [tag, slugSet] of counts) {
    const coMap = co.get(tag) ?? new Map();
    const coOccurring = [...coMap.entries()]
      .map(([t, n]) => ({ tag: t, count: n }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 3);
    summaries.push({
      tag,
      count: slugSet.size,
      bookSlugs: [...slugSet].sort(),
      coOccurring,
    });
  }
  summaries.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return summaries;
}

// Books that carry a specific tag, returned in finish-date desc order
// then by title. Powers /tags/[tag].
export async function getBooksByTag(tag: string): Promise<Book[]> {
  const books = await getAllBooks();
  return books
    .filter((b) => b.tags.includes(tag))
    .sort((a, b) => {
      const ad = a.finished ?? a.started ?? "";
      const bd = b.finished ?? b.started ?? "";
      if (ad && bd && ad !== bd) return bd.localeCompare(ad);
      return a.title.localeCompare(b.title);
    });
}

// Score the similarity between two books from vault data alone. Reasons
// are returned alongside the score so the UI can explain the connection
// rather than just presenting a number.
//
// Weights tuned by feel: explicit links (see_also, series) are worth more
// than incidental overlap (shared tags), since the user has put thought
// into the explicit ones. Score zero means "no signal" — caller filters.
function scorePair(a: Book, b: Book): { score: number; reasons: ConnectionReason[] } {
  const reasons: ConnectionReason[] = [];
  let score = 0;

  const aLinksB = a.seeAlso.includes(b.slug);
  const bLinksA = b.seeAlso.includes(a.slug);
  if (aLinksB && bLinksA) {
    score += 6;
    reasons.push({ kind: "see-also", detail: "linked both ways" });
  } else if (aLinksB || bLinksA) {
    score += 4;
    reasons.push({ kind: "see-also", detail: "linked" });
  }

  if (a.series && a.series === b.series) {
    score += 5;
    reasons.push({ kind: "series", detail: a.series });
  }

  const sharedAuthors = a.authors.filter((x) => b.authors.includes(x));
  if (sharedAuthors.length > 0) {
    score += 3 * sharedAuthors.length;
    reasons.push({ kind: "author", detail: sharedAuthors.join(", ") });
  }

  const sharedTags = a.tags.filter((t) => b.tags.includes(t));
  if (sharedTags.length > 0) {
    // Cap tag contribution so a long shared-tag list doesn't dominate
    // explicit signals; render up to three tags in the reason.
    score += Math.min(sharedTags.length, 5);
    reasons.push({ kind: "tag", detail: sharedTags.slice(0, 3).join(", ") });
  }

  return { score, reasons };
}

// Random pullquote from any finished book that has one. The home page
// renders this as a quiet "from the shelf" line — feels different on
// each page-load (the route is force-dynamic), without any UI controls.
// Returns the picked book alongside so the home page can link to it.
// Top-N words across every review.md the reader has written. The
// "self-portrait" view from `/stats`. Pure introspection — what do you
// keep saying. Stop-words and very short tokens are filtered; the
// remaining counts are returned in descending order.

const WORD_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "i",
  "me",
  "my",
  "mine",
  "you",
  "your",
  "yours",
  "he",
  "she",
  "him",
  "her",
  "his",
  "hers",
  "they",
  "them",
  "their",
  "theirs",
  "we",
  "us",
  "our",
  "ours",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "why",
  "how",
  "not",
  "no",
  "nor",
  "so",
  "if",
  "then",
  "than",
  "also",
  "very",
  "much",
  "more",
  "most",
  "some",
  "any",
  "all",
  "each",
  "every",
  "one",
  "two",
  "three",
  "four",
  "five",
  "first",
  "last",
  "now",
  "still",
  "just",
  "even",
  "only",
  "really",
  "quite",
  "such",
  "into",
  "over",
  "under",
  "through",
  "between",
  "again",
  "there",
  "here",
  "because",
  "while",
  "both",
  "either",
  "neither",
  "either",
  "about",
  "against",
  "up",
  "down",
  "out",
  "off",
  "across",
  "before",
  "after",
  "during",
  "without",
  "within",
  "upon",
  "like",
  "unlike",
  "yet",
  "though",
  "although",
  "since",
  "ever",
  "never",
  "always",
  "often",
  "sometimes",
  "usually",
  "rarely",
  "seemed",
  "seems",
  "feel",
  "felt",
  "felt",
  "made",
  "make",
  "makes",
  "made",
  "get",
  "gets",
  "got",
  "go",
  "goes",
  "went",
  "gone",
  "come",
  "came",
  "comes",
  "take",
  "took",
  "taken",
  "takes",
  "want",
  "wanted",
  "wants",
  "said",
  "says",
  "saying",
  "told",
  "tell",
  "tells",
  "read",
  "reading",
  "reads",
  "book",
  "books",
  "story",
  "stories",
  "novel",
  "novels",
  "author",
  "character",
  "characters",
  "page",
  "pages",
  "chapter",
  "chapters",
  "plot",
  "narrative",
  "prose",
  "writer",
  "writing",
  "rather",
  "being",
  "been",
  "done",
  "seem",
  "seemed",
  "quite",
  "perhaps",
  "maybe",
  "mostly",
]);

export type WordCount = { word: string; count: number };

export async function getReviewWordFrequency(limit = 40): Promise<WordCount[]> {
  const books = await getAllBooks();
  const counts = new Map<string, number>();

  for (const book of books) {
    if (!book.hasReview) continue;
    const reviewPath = path.join(booksDir(), book.slug, "review.md");
    const text = await readOptionalFile(reviewPath);
    if (!text) continue;
    // Strip frontmatter delimiters defensively (review.md doesn't carry
    // them, but if a stray review starts with --- we don't want to count
    // YAML keys as words).
    const stripped = text.replace(/^---[\s\S]*?---/m, "");
    // Also strip code fences and links.
    const cleaned = stripped
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~>#]/g, " ");
    const tokens = cleaned.toLowerCase().match(/[a-z][a-z'’]{2,}/g) ?? [];
    for (const raw of tokens) {
      const word = raw.replace(/[’']s$/i, "").replace(/[’']/g, "");
      if (word.length < 4) continue;
      if (WORD_STOP_WORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .filter((w) => w.count >= 2) // singletons are noise
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

// Consecutive-finish "X before Y" patterns. Walks finished books in
// chronological finish order and tallies ordered adjacent pairs.
// Returns pairs that occur at least `minOccurrences` times. Useful
// when the reader has a habit (say, reading the next book in a series
// immediately after the previous one — surface that as a pattern).

export type FinishPair = {
  beforeSlug: string;
  beforeTitle: string;
  afterSlug: string;
  afterTitle: string;
  count: number;
};

export async function getFinishPairs(minOccurrences = 2): Promise<FinishPair[]> {
  const books = await getAllBooks();
  const finished = books
    .filter((b) => b.status === "finished" && b.finished)
    .sort((a, b) => (a.finished as string).localeCompare(b.finished as string));

  const tallies = new Map<string, FinishPair>();
  for (let i = 0; i < finished.length - 1; i++) {
    const a = finished[i];
    const b = finished[i + 1];
    if (a.slug === b.slug) continue; // same book listed twice (edge)
    const key = `${a.slug} ${b.slug}`;
    const existing = tallies.get(key);
    if (existing) {
      existing.count++;
    } else {
      tallies.set(key, {
        beforeSlug: a.slug,
        beforeTitle: a.title,
        afterSlug: b.slug,
        afterTitle: b.title,
        count: 1,
      });
    }
  }

  return [...tallies.values()]
    .filter((p) => p.count >= minOccurrences)
    .sort((a, b) => b.count - a.count || a.beforeTitle.localeCompare(b.beforeTitle));
}

export async function getRandomPullquote(): Promise<{
  book: Book;
  pullquote: NonNullable<Book["pullquote"]>;
} | null> {
  const books = await getAllBooks();
  const candidates = books.filter(
    (b): b is Book & { pullquote: NonNullable<Book["pullquote"]> } =>
      b.pullquote !== null && b.status === "finished",
  );
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return { book: pick, pullquote: pick.pullquote };
}

// One finished book the reader hasn't touched in a while, surfaced as a
// "remember this?" card on the home page. Pool: status=finished and
// finished date older than the threshold. Re-rolled per page-load, so
// the home feels alive across refreshes. `yearsAgo` is computed against
// the same `today` as the cutoff, kept here so the renderer doesn't
// have to call `Date.now()` itself (server-component purity rule).
export async function getSerendipity(
  thresholdDays = 365,
  today: Date = new Date(),
): Promise<{ book: Book; yearsAgo: number } | null> {
  const books = await getAllBooks();
  const todayMs = today.getTime();
  const cutoffMs = todayMs - thresholdDays * 86400000;
  const candidates = books.filter((b) => {
    if (b.status !== "finished" || !b.finished) return false;
    const finishedMs = Date.parse(`${b.finished}T12:00:00Z`);
    return Number.isFinite(finishedMs) && finishedMs < cutoffMs;
  });
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const finishedMs = Date.parse(`${pick.finished}T12:00:00Z`);
  const yearsAgo = Math.max(1, Math.floor((todayMs - finishedMs) / (365.25 * 86400000)));
  return { book: pick, yearsAgo };
}

// Top-N books most similar to the given slug, by the same scoring used
// for /discover. Excludes the book itself; null score (no signal) drops
// out. Returns lite summaries — the per-book sidebar only renders
// title/author/cover.
export async function getSimilarBooks(
  slug: string,
  limit = 3,
): Promise<Array<{ book: Connection["a"]; score: number; reasons: ConnectionReason[] }>> {
  const books = await getAllBooks();
  const target = books.find((b) => b.slug === slug);
  if (!target) return [];
  const pool = books.filter((b) => b.slug !== slug);

  const scored = pool
    .map((b) => {
      const { score, reasons } = scorePair(target, b);
      return { book: lite(b), score, reasons };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title));
  return scored.slice(0, limit);
}

// Top-N most-connected book pairs in the vault, ranked by similarity.
// Considers finished + currently-reading books only — TBR entries don't
// have tags or full schema, and abandoned books would clutter "what
// else might I like" surfaces. Symmetric: each pair counted once.
export async function getConnections(limit = 20): Promise<Connection[]> {
  const books = await getAllBooks();
  const pool = books.filter((b) => b.status === "finished" || b.status === "reading");
  const connections: Connection[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const { score, reasons } = scorePair(pool[i], pool[j]);
      if (score === 0) continue;
      connections.push({
        a: lite(pool[i]),
        b: lite(pool[j]),
        score,
        reasons,
      });
    }
  }
  connections.sort((a, b) => b.score - a.score || a.a.title.localeCompare(b.a.title));
  return connections.slice(0, limit);
}

function lite(b: Book): Connection["a"] {
  return { slug: b.slug, title: b.title, authors: b.authors, cover: b.cover };
}

// Reading-log entries from past years that share today's month-and-day.
// "On this day" — finds anniversaries of starts, finishes, or manual log
// notes from previous calendar years. Today is excluded (no point telling
// you what you did this morning); current year past-dates are excluded
// too — those are still "this year," not "on this day in a past year".
export async function getOnThisDay(today: Date = new Date()): Promise<LogEntry[]> {
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const currentYear = today.getUTCFullYear();
  const log = await getReadingLog();
  return log.filter((e) => {
    const [yStr, m, d] = e.date.split("-");
    return Number(yStr) < currentYear && m === mm && d === dd;
  });
}

// One entry per calendar day in the year, with a count of reading events
// (started + finished + manual log) on that day. Powers the heatmap on
// `/stats/[year]`.
export async function getYearActivity(year: number): Promise<DayActivity[]> {
  const [books, manual] = await Promise.all([getAllBooks(), getManualLogEntries()]);
  const counts = new Map<string, number>();
  const bump = (date: string | null) => {
    if (!date) return;
    if (!date.startsWith(`${year}-`)) return;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  };
  for (const b of books) {
    bump(b.started);
    bump(b.finished);
  }
  for (const m of manual) bump(m.date);

  const days: DayActivity[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year, 11, 31);
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    const date = d.toISOString().slice(0, 10);
    days.push({ date, weekday: d.getUTCDay(), count: counts.get(date) ?? 0 });
  }
  return days;
}

// Aggregate every available stat for one calendar year. Pure derivation
// from frontmatter — pages-read / longest-book are intentionally absent
// (no `pages` field in the schema yet, and we don't pull from external
// APIs without an explicit token).
export async function getYearStats(year: number): Promise<YearStats> {
  const books = await getAllBooks();
  const inYear = (date: string | null) => date?.startsWith(`${year}-`);

  const finishedThisYear = books.filter((b) => inYear(b.finished) && b.status === "finished");
  const abandonedThisYear = books.filter((b) => inYear(b.finished) && b.status === "abandoned");
  const startedInYear = books.filter((b) => inYear(b.started));

  const rated = finishedThisYear.filter((b) => b.rating !== null);
  const averageRating =
    rated.length > 0 ? rated.reduce((sum, b) => sum + (b.rating ?? 0), 0) / rated.length : null;

  // Histogram buckets 1..5; half-stars round to nearest whole.
  const distMap = new Map<number, number>();
  for (let r = 1; r <= 5; r++) distMap.set(r, 0);
  for (const b of rated) {
    if (b.rating === null) continue;
    const bucket = Math.max(1, Math.min(5, Math.round(b.rating)));
    distMap.set(bucket, (distMap.get(bucket) ?? 0) + 1);
  }
  const ratingDistribution = [...distMap.entries()]
    .map(([rating, count]) => ({ rating, count }))
    .sort((a, b) => b.rating - a.rating);

  const tagCounts = new Map<string, number>();
  for (const b of finishedThisYear) {
    for (const t of b.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 8);

  const authorCounts = new Map<string, number>();
  for (const b of finishedThisYear) {
    for (const a of b.authors) authorCounts.set(a, (authorCounts.get(a) ?? 0) + 1);
  }
  const topAuthors = [...authorCounts.entries()]
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author))
    .slice(0, 8);

  return {
    year,
    finished: finishedThisYear.length,
    abandoned: abandonedThisYear.length,
    startedInYear: startedInYear.length,
    rated: rated.length,
    averageRating,
    ratingDistribution,
    topTags,
    topAuthors,
    wouldReread: finishedThisYear.filter((b) => b.wouldReread === true).length,
  };
}
