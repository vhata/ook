import { cache } from "react";
import { getAllBooks } from "@/lib/books";
import type { Book } from "@/lib/types";

// Pure helper for the "5-star unreviewed" opportunistic prompt. When
// the /admin agent has staged a patch and the user is about to commit
// it, we surface ONE candidate from this list as an optional follow-up
// question — "Quick — why was <Title> a five?" The answer (when
// provided) is bundled into the SAME commit as the staged patch via a
// second CommitPatchInput that writes <slug>/review.md.
//
// Same offline-clean discipline as the rest of /admin: pure derivation
// from the in-memory corpus (via `getAllBooks`), no external fetches.
// Returned `FiveStarUnreviewed` records carry only what the prompt
// renderer needs — the rest of the Book record stays where it lives.
//
// Selection criteria:
//   - status === "finished" (other statuses don't have a "how it
//     landed" axis worth capturing yet — the user might still change
//     their mind on a reading/paused book).
//   - rating === 5 (signal-rich end of the scale; orthogonal to the
//     review/rate prompts on /admin/backfill which target the
//     ≥ 4 / rating-null gaps).
//   - !hasReview (the file <slug>/review.md is absent — `hasReview` is
//     stamped by the build-time index + walk-fallback parser).
//
// "One ask per session per book" — the offered/skipped tracking lives
// on the client (component state, evaporates on tab close). The helper
// is stateless: callers pass an `excluding` set of slugs and the
// helper skips them.

export type FiveStarUnreviewed = {
  slug: string;
  title: string;
  authors: string[];
  cover: string | null;
};

// Pure filter. Exported for tests + callers that already hold a corpus
// (e.g. a future surface that wants to list every candidate rather
// than pick one).
export function fiveStarUnreviewed(books: Book[]): FiveStarUnreviewed[] {
  return books
    .filter((b) => b.status === "finished" && b.rating === 5 && !b.hasReview)
    .map((b) => ({
      slug: b.slug,
      title: b.title,
      authors: b.authors,
      cover: b.cover,
    }));
}

// Pick one candidate, skipping any slug in `excluding`. Returns null
// when the pool is exhausted for this session. Stable ordering — we
// take the first remaining candidate after the helper's natural
// `getAllBooks` order, so re-asking after a refresh surfaces the same
// book next (no flicker, no surprise reordering).
export function pickOne(
  candidates: FiveStarUnreviewed[],
  excluding: ReadonlySet<string> = new Set(),
): FiveStarUnreviewed | null {
  for (const c of candidates) {
    if (!excluding.has(c.slug)) return c;
  }
  return null;
}

// React cache() so a single render's call doesn't re-walk the corpus.
// Mirrors the `getBackfillQuestions` idiom in admin/backfill.ts.
export const getFiveStarUnreviewed = cache(async (): Promise<FiveStarUnreviewed[]> => {
  const books = await getAllBooks();
  return fiveStarUnreviewed(books);
});
