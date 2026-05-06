import { z } from "zod";
import { getStore, keys } from "../store";
import type { Book, BingoCard } from "../types";

// Tool implementations as plain async functions. The MCP server in
// route.ts wires these into the SDK; tests can call them directly with
// a memory-store. Keeping the SDK glue separate keeps the business
// logic testable without spinning up a transport.

// Slim view returned by list_books. Catalog only — fetching the full
// reference notes goes through get_book to keep the prompt-injection
// surface tight.
export type BookSummary = {
  slug: string;
  title: string;
  author: string;
  status: string;
  year: number | null;
  tags?: string[];
  bingoSquare?: string;
};

export const listBooksInputSchema = {
  status: z
    .string()
    .optional()
    .describe("Filter by status (tbr/reading/finished/abandoned/paused)"),
  year: z
    .number()
    .int()
    .optional()
    .describe("Filter by finish-year. 0 means books with no finish date."),
  author: z
    .string()
    .optional()
    .describe("Substring match against any author name (case-insensitive)"),
  tag: z.string().optional().describe("Filter to books carrying this tag"),
};

type ListBooksInput = {
  status?: string;
  year?: number;
  author?: string;
  tag?: string;
};

export async function listBooks(input: ListBooksInput): Promise<BookSummary[]> {
  const store = getStore();
  const slugs = await store.smembers(keys.booksIndex());
  const books = (await Promise.all(slugs.map((slug) => store.get<Book>(keys.book(slug))))).filter(
    (b): b is Book => b !== null,
  );

  const filtered = books.filter((b) => {
    if (input.status && b.status !== input.status) return false;
    if (input.year !== undefined) {
      const year = b.finished ? Number(b.finished.slice(0, 4)) : null;
      if (year !== input.year && !(input.year === 0 && year === null)) return false;
    }
    if (input.author) {
      const needle = input.author.toLowerCase();
      const hit = b.authors.some((a) => a.toLowerCase().includes(needle));
      if (!hit) return false;
    }
    if (input.tag && !b.tags.includes(input.tag)) return false;
    return true;
  });

  // Stable ordering: most-recently-finished first; reading next; rest by title.
  filtered.sort((a, b) => {
    const af = a.finished ?? "";
    const bf = b.finished ?? "";
    if (af !== bf) return bf.localeCompare(af);
    return a.title.localeCompare(b.title);
  });

  return filtered.map((b) => {
    const summary: BookSummary = {
      slug: b.slug,
      title: b.title,
      author: b.authors[0] ?? "(unknown)",
      status: b.status,
      year: b.finished ? Number(b.finished.slice(0, 4)) : null,
    };
    if (b.tags.length > 0) summary.tags = b.tags;
    if (b.bingoSquares.length > 0) summary.bingoSquare = b.bingoSquares[0];
    return summary;
  });
}

// Full bingo card from the store. Mirror of get_book in shape — read
// path, no mutation. The bind tool is a separate operation built on
// commit_patch.
export const listBingoInputSchema = {
  year: z.number().int().describe("Year of the bingo card (e.g. 2026)"),
};

export async function listBingo(input: { year: number }): Promise<BingoCard | null> {
  const store = getStore();
  return await store.get<BingoCard>(keys.bingo(input.year));
}
