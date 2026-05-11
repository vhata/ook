import { cache } from "react";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getAllBooks } from "@/lib/books";
import type { Book } from "@/lib/types";
import { topCandidates, type PullquoteCandidate } from "@/lib/admin/pullquote-suggester";

// Gap-finder for /admin/backfill. Picks a handful of small "fill this
// in" questions per visit — drawn from the corpus of finished books
// that are missing one piece of metadata each. The page renders them
// as skip-or-save cards, then bundles each saved answer through the
// existing /api/admin/agent/commit endpoint so audit + trailer apply
// uniformly.
//
// Same offline-clean discipline as the rest of the admin surfaces:
// pure derivation from the in-memory corpus (via `getAllBooks`), no
// external fetches at request time. The `pullquote` kind is the
// exception — it reads each candidate book's quotes.md off disk to
// score candidate lines, but the read is local fs only.

export type BackfillKind = "rate" | "review" | "wouldReread" | "pullquote";

export type BackfillQuestion = {
  // Discriminant for the renderer. New kinds extend this union; the
  // client component switches on `kind` to choose the input shape.
  kind: BackfillKind;
  bookSlug: string;
  bookTitle: string;
  bookAuthors: string[];
  bookCover: string | null;
  // The prompt rendered above the input. Computed at question-build
  // time so the renderer doesn't have to know what each kind is
  // asking — keeps the kind/copy mapping in one place.
  prompt: string;
  // The current value of the field this question is targeting, when
  // it's useful context for the prompt (e.g. the existing rating for
  // a wouldReread question). Null when irrelevant.
  context?: number | null;
  // Pre-computed candidate quotes (only set when `kind === "pullquote"`).
  // The card renders these as numbered picker buttons; one tap stages
  // a `pullquote: { text, source }` frontmatter patch.
  candidates?: PullquoteCandidate[];
};

// One "candidate" pool per kind. The kind-builders below run over the
// whole corpus and pick books that match each gap's criteria; the
// outer assembler shuffles them together to pick `count` total.

type Candidate = BackfillQuestion;

function rateCandidates(books: Book[]): Candidate[] {
  // Finished + no rating yet. The most common gap by far for the
  // Goodreads-import cohort, where some books came across without a
  // rating attached.
  return books
    .filter((b) => b.status === "finished" && b.rating === null)
    .map((b) => ({
      kind: "rate" as const,
      bookSlug: b.slug,
      bookTitle: b.title,
      bookAuthors: b.authors,
      bookCover: b.cover,
      prompt: `How would you rate ${b.title}?`,
    }));
}

function reviewCandidates(books: Book[]): Candidate[] {
  // Finished, rated ≥ 4, no review.md. The bar is "you liked it
  // enough that capturing why is worth the effort". Books rated lower
  // intentionally don't prompt — a review on a 2-star is not no-
  // homework-friendly.
  return books
    .filter(
      (b) =>
        b.status === "finished" && typeof b.rating === "number" && b.rating >= 4 && !b.hasReview,
    )
    .map((b) => ({
      kind: "review" as const,
      bookSlug: b.slug,
      bookTitle: b.title,
      bookAuthors: b.authors,
      bookCover: b.cover,
      prompt: `${b.title} was a ${b.rating}-star — want to write a sentence or two about why?`,
      context: b.rating,
    }));
}

function wouldRereadCandidates(books: Book[]): Candidate[] {
  // Finished, rated 5, wouldReread untouched. The signal-rich end of
  // the rating scale; "would I re-read this?" is the natural followup
  // to a top rating but is often left blank on bulk imports.
  return books
    .filter((b) => b.status === "finished" && b.rating === 5 && b.wouldReread === null)
    .map((b) => ({
      kind: "wouldReread" as const,
      bookSlug: b.slug,
      bookTitle: b.title,
      bookAuthors: b.authors,
      bookCover: b.cover,
      prompt: `Would you re-read ${b.title}?`,
      context: b.rating,
    }));
}

// Finished books with a quotes.md AND no pullquote yet. Each candidate
// carries up to three suggested lines from quotes.md, pre-scored by
// `topCandidates`; the card renders them as numbered picker buttons.
// Async because we read each candidate book's quotes.md off disk —
// the only fs read in the backfill candidate-building pass.
//
// Exported for tests. Pass a custom `readQuotes` to drive coverage
// without spawning the filesystem.
export async function pullquoteCandidates(
  books: Book[],
  readQuotes: (slug: string) => Promise<string | null>,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const b of books) {
    if (b.status !== "finished" || b.pullquote !== null || !b.hasQuotes) continue;
    const body = await readQuotes(b.slug);
    if (!body) continue;
    const cands = topCandidates(body, 3);
    if (cands.length === 0) continue;
    out.push({
      kind: "pullquote" as const,
      bookSlug: b.slug,
      bookTitle: b.title,
      bookAuthors: b.authors,
      bookCover: b.cover,
      prompt: `${b.title} has ${cands.length} pullquote candidate${cands.length === 1 ? "" : "s"} — pick one?`,
      candidates: cands,
    });
  }
  return out;
}

// Fisher–Yates shuffle. Plain Math.random — the user noted in the
// brief that they're fine with the same set on a fast reload; we
// don't want to maintain a seedable RNG just for this.
function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pure, exported for tests. Pass a pre-fetched corpus + an optional
// RNG; returns up to `count` randomly-selected questions across all
// kinds. Behaviour:
//   - Each kind's candidate pool is shuffled independently so the
//     selection isn't dominated by whichever kind happens to have the
//     most candidates.
//   - We interleave kinds in a round-robin so the user always sees a
//     mix when more than one kind has candidates, rather than three
//     "rate this" cards in a row.
//   - When the total pool is smaller than `count`, return what's
//     there; the page renders an empty / partial state.
//   - We dedupe by slug so the same book doesn't appear twice on a
//     visit, even when it has two kinds of gap (e.g. a 5-star with no
//     review AND no wouldReread). The interleave order prefers the
//     first-appearing kind, which is reviewCandidates → rateCandidates
//     → wouldRereadCandidates (see the order below).
export function pickQuestions(
  books: Book[],
  count: number,
  rng: () => number = Math.random,
  pullquotePool: Candidate[] = [],
): BackfillQuestion[] {
  // Order matters for interleave. Pullquote-pick goes first when
  // present — it's the highest-voice surface (the reader committed a
  // line to quotes.md, picking one for the headline is pure curation).
  // Review next because a 4+ star book without a review is the next
  // highest-signal capture opportunity. Rate then wouldReread close
  // the order on the low-cost-but-low-voice gaps. Dedupe-by-slug
  // downstream means a 4-star book that qualifies for several kinds
  // prefers the earlier-listed one.
  const pools: Candidate[][] = [
    shuffle(pullquotePool, rng),
    shuffle(reviewCandidates(books), rng),
    shuffle(rateCandidates(books), rng),
    shuffle(wouldRereadCandidates(books), rng),
  ];

  const seen = new Set<string>();
  const out: BackfillQuestion[] = [];
  let exhausted = 0;
  while (out.length < count && exhausted < pools.length) {
    exhausted = 0;
    for (const pool of pools) {
      if (out.length >= count) break;
      // Pull from this pool's front, skipping any slugs we've already
      // chosen for another kind on this same visit.
      let next: Candidate | undefined;
      while ((next = pool.shift())) {
        if (!seen.has(next.bookSlug)) {
          seen.add(next.bookSlug);
          out.push(next);
          break;
        }
      }
      if (!next) exhausted++;
    }
  }
  return out;
}

// React cache() so a single render's getBackfillQuestions call doesn't
// re-walk the corpus twice; getAllBooks itself is also cache()'d.
// `count` is part of the cache key because cache() hashes args, but
// the typical page calls it once per request anyway.
export const getBackfillQuestions = cache(async (count: number): Promise<BackfillQuestion[]> => {
  const books = await getAllBooks();
  const pullquotePool = await pullquoteCandidates(books, defaultReadQuotes);
  return pickQuestions(books, count, undefined, pullquotePool);
});

// Inline fs reader for the pullquote candidate builder. Matches the
// resolution `getBookBySlug` uses in `src/lib/books.ts` so dev and
// prod see the same vault layout.
async function defaultReadQuotes(slug: string): Promise<string | null> {
  const dir =
    process.env.BOOKS_DIR ??
    process.env.NEXT_PUBLIC_BOOKS_DIR ??
    path.join(process.cwd(), ".vault");
  const file = path.join(dir, slug, "quotes.md");
  try {
    return await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
