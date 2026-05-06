import yaml from "js-yaml";
import matter from "gray-matter";
import { z } from "zod";
import { getVaultClient } from "../github";
import { getStore, keys } from "../store";
import type { BingoCard } from "../types";

// bind_book_to_bingo_square — set or clear the `book:` field for a
// named square in `_meta/bingo-<year>.md`. The renderer derives
// done-ness from the linked book's status (since adb5175), so this is
// the only mutation needed to "claim" a square.
//
// Pure YAML manipulation — bingo files have no body, just frontmatter.

export const bindBookToBingoSquareInputSchema = {
  year: z.number().int().describe("Year of the bingo card (e.g. 2026)"),
  square_id: z.string().describe('Square id (e.g. "a1", "b2")'),
  book_slug: z.string().nullable().describe("Book slug to bind, or null to unbind."),
  commit_message: z.string().min(1),
};

const inputSchema = z.object(bindBookToBingoSquareInputSchema);

export type BindResult = {
  ok: true;
  year: number;
  square_id: string;
  book_slug: string | null;
  commit: { path: string; sha: string; url: string | null };
};

export async function bindBookToBingoSquare(input: {
  year: number;
  square_id: string;
  book_slug: string | null;
  commit_message: string;
}): Promise<BindResult> {
  inputSchema.parse(input);

  const client = getVaultClient();
  const filePath = `_meta/bingo-${input.year}.md`;
  const file = await client.getFile(filePath);
  if (!file) {
    throw new Error(`Bingo card not found for year ${input.year}`);
  }

  const parsed = matter(file.content);
  const data = JSON.parse(JSON.stringify(parsed.data)) as Record<string, unknown>;
  if (!Array.isArray(data.squares)) {
    throw new Error(`Bingo card ${input.year} has no squares array`);
  }

  const squares = data.squares as Array<Record<string, unknown>>;
  const square = squares.find((s) => s.id === input.square_id);
  if (!square) {
    throw new Error(`Square ${input.square_id} not found on bingo-${input.year}`);
  }
  if (square.free === true) {
    throw new Error(`Cannot bind a book to the free square (${input.square_id})`);
  }

  // Sanity-check: if binding a slug, make sure the slug actually exists
  // in the store. Doesn't block, but warns the agent (and the diff
  // preview will surface this back to the user).
  if (input.book_slug) {
    const exists = await getStore().get(keys.book(input.book_slug));
    if (!exists) {
      throw new Error(
        `Refusing to bind: book slug "${input.book_slug}" not found in the store. ` +
          `Reindex first if it was just added to the vault.`,
      );
    }
  }

  square.book = input.book_slug;

  // Re-emit the YAML. Bingo files have no body so the trailing `---`
  // closes the file.
  const dumped = yaml.dump(data, { lineWidth: 1000, noRefs: true });
  const newContent = `---\n${dumped}---\n`;

  const result = await client.commitFile({
    filePath,
    content: newContent,
    message: input.commit_message,
    sha: file.sha,
  });

  // Invalidate the store entry for this card so subsequent list_bingo
  // calls re-fetch from disk on the next reindex (or fall through).
  // Optimistic update: update the parsed card in-place if we still
  // know its shape.
  const store = getStore();
  const cached = await store.get<BingoCard>(keys.bingo(input.year));
  if (cached) {
    const idx = cached.squares.findIndex((s) => s.id === input.square_id);
    if (idx >= 0) {
      const updated = { ...cached };
      updated.squares = [...cached.squares];
      updated.squares[idx] = {
        ...updated.squares[idx],
        book: input.book_slug,
        // done-ness is derived; the renderer recomputes on read.
      };
      await store.set(keys.bingo(input.year), updated);
    }
  }

  return {
    ok: true,
    year: input.year,
    square_id: input.square_id,
    book_slug: input.book_slug,
    commit: { path: filePath, sha: result.sha, url: result.url },
  };
}
