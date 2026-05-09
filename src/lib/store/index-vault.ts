import { getAllBingoCards, getAllBooks } from "../books";
import { getStore, keys } from "./index";
import type { Store } from "./types";

// Walks the on-disk vault and materialises the read view used by the
// MCP `list_books` / `get_book` tools. Lifted into the store so MCP
// reads don't have to scan the filesystem on every tool call.
//
// The vault remains the source of truth — this index is regenerable
// from any vault commit. Webhook on push (or the admin reindex
// endpoint) is the trigger; nothing in here writes back to disk.
//
// Strategy:
//   1. Snapshot the vault (books + bingo cards) up-front.
//   2. Wipe the existing book/bingo keys so deleted-from-vault entries
//      don't linger.
//   3. Write the new keyspace.
//   4. Replace the books:index set atomically (delete + re-add).
//   5. Replace the bingo:years set likewise.
//
// "Atomic" here is best-effort — Upstash REST can't do real
// transactions across keys, and a partial failure mid-reindex would
// leave the index out of sync. The mitigation is that reindex is cheap
// enough to run again from the admin endpoint, and writes are
// idempotent.

export type ReindexResult = {
  books: number;
  bingoCards: number;
  removed: number;
};

// Where the reindex was triggered from. "admin" = manual button click;
// "webhook" = GitHub push to vhata/books; "manual" = a script or other
// caller. Stored alongside the timestamp so the operator can tell at a
// glance whether automation is keeping the store fresh.
export type ReindexSource = "admin" | "webhook" | "manual";

export type LastReindex = {
  at: string; // ISO timestamp
  source: ReindexSource;
  books: number;
  bingoCards: number;
};

export async function reindex(
  store: Store = getStore(),
  source: ReindexSource = "manual",
): Promise<ReindexResult> {
  const [books, bingoCards] = await Promise.all([getAllBooks(), getAllBingoCards()]);

  const removed =
    (await store.delByPrefix("book:")) +
    (await store.delByPrefix("bingo:")) +
    (await store.delByPrefix("books:index")) +
    (await store.delByPrefix("bingo:years"));

  // Books.
  await Promise.all(books.map((b) => store.set(keys.book(b.slug), b)));
  if (books.length > 0) {
    await store.sadd(keys.booksIndex(), ...books.map((b) => b.slug));
  }

  // Bingo cards.
  await Promise.all(bingoCards.map((c) => store.set(keys.bingo(c.year), c)));
  if (bingoCards.length > 0) {
    await store.sadd(keys.bingoYears(), ...bingoCards.map((c) => String(c.year)));
  }

  // Stamp the last-reindex record. Read on the GET side of the
  // /api/admin/reindex endpoint so the /admin UI can surface freshness.
  const lastReindex: LastReindex = {
    at: new Date().toISOString(),
    source,
    books: books.length,
    bingoCards: bingoCards.length,
  };
  await store.set(keys.lastReindex(), lastReindex);

  return { books: books.length, bingoCards: bingoCards.length, removed };
}
