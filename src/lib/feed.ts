import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getAllBooks } from "./books";
import type { Book } from "./types";

export type FeedItem = {
  book: Book;
  url: string;
  title: string;
  summary: string;
  // ISO-8601 timestamp of the finish (or fall back to the start date when
  // status is reading). RSS/JSON readers use this for chronological order.
  publishedAt: string;
};

// Returns the most recent N finished books shaped for feed rendering. A
// finished book without a `finished` date is skipped — without a date the
// feed reader has nothing to sort on.
export async function getFeedItems(siteUrl: string, limit = 30): Promise<FeedItem[]> {
  const books = await getAllBooks();
  const items: FeedItem[] = [];
  for (const b of books) {
    if (b.status !== "finished" || !b.finished) continue;
    const title = b.authors.length > 0 ? `${b.title} — ${b.authors.join(", ")}` : b.title;
    items.push({
      book: b,
      url: `${siteUrl}/books/${encodeURIComponent(b.slug)}`,
      title,
      summary: await summaryForBook(b),
      publishedAt: `${b.finished}T12:00:00Z`,
    });
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return items.slice(0, limit);
}

// Build a short feed summary from whatever signal the book has. Pullquote
// is the most concise; fall back to the first paragraph of review.md, then
// to a bare "Finished YYYY-MM-DD" stamp. Never reaches into the body
// markdown — those are the deep notes that the tier-2 endpoint guards.
async function summaryForBook(book: Book): Promise<string> {
  if (book.pullquote) {
    const src = book.pullquote.source ? ` — ${book.pullquote.source}` : "";
    return `“${book.pullquote.text}”${src}`;
  }
  if (book.hasReview) {
    const firstParagraph = await readFirstParagraph(book.slug, "review.md");
    if (firstParagraph) return firstParagraph;
  }
  return `Finished ${book.finished}.`;
}

async function readFirstParagraph(slug: string, file: string): Promise<string | null> {
  const dir = process.env.BOOKS_DIR ?? path.join(process.cwd(), ".vault");
  const target = path.join(dir, slug, file);
  try {
    const raw = await fs.readFile(target, "utf8");
    const { content } = matter(raw);
    const para = content
      .trim()
      .split(/\n\s*\n/)[0]
      ?.replace(/\s+/g, " ")
      .trim();
    if (!para) return null;
    return para.length > 280 ? `${para.slice(0, 277)}…` : para;
  } catch {
    return null;
  }
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
