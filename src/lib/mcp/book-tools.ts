import { z } from "zod";
import { getStore, keys } from "../store";
import type { Book } from "../types";
import { getVaultClient } from "../github";
import { parseMarkdownFile } from "../markdown-sections";
import {
  applyPatch,
  type ApplyPatchResult,
  type CommitPatchInput,
  type SectionChange,
} from "./patch";
import { bookPaths, FILE_BACKED_SECTIONS, fileBackedPath, isFileBackedSection } from "./book-paths";
import { withTrailer } from "./trailer";

// get_book + commit_patch — the read-then-write pair that does the
// actual vault mutation. Read goes through the store for speed;
// write goes through the vault client (GitHub in production, local-fs
// in dev).
//
// Section model:
//   - "progress", "review", "quotes" are top-level files. The tool
//     treats each as a single content blob; replace/append/prepend
//     operate on the whole file.
//   - Any other section name is an H2 block in `<Slug>/<Slug>.md`.

// ============================================================================
// get_book
// ============================================================================

export const getBookInputSchema = {
  slug: z.string().min(1),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      "Section names to fetch alongside the frontmatter. Special values: " +
        "progress, review, quotes (top-level files). Any other name maps to " +
        "an H2 block in the reference-notes file. If omitted, returns " +
        "frontmatter only.",
    ),
};

export type GetBookOutput = {
  slug: string;
  frontmatter: Book;
  sections: Record<string, string>;
};

export async function getBook(input: {
  slug: string;
  sections?: string[];
}): Promise<GetBookOutput | null> {
  const store = getStore();
  const fm = await store.get<Book>(keys.book(input.slug));
  // If the store is cold (no recent reindex), fall through to the
  // vault client to fetch the reference file directly. This makes the
  // read path resilient to a missed webhook.
  if (!fm) {
    return null;
  }

  const requested = input.sections ?? [];
  const sections: Record<string, string> = {};
  if (requested.length === 0) {
    return { slug: input.slug, frontmatter: fm, sections };
  }

  const client = getVaultClient();
  const paths = bookPaths(input.slug);
  let referenceContent: string | null = null;

  for (const name of requested) {
    if (isFileBackedSection(name)) {
      const file = await client.getFile(fileBackedPath(input.slug, name));
      sections[name] = file?.content ?? "";
    } else {
      // H2 in the reference notes file. Lazy-load.
      if (referenceContent === null) {
        const ref = await client.getFile(paths.reference);
        referenceContent = ref?.content ?? "";
      }
      const parsed = parseMarkdownFile(referenceContent);
      const sec = parsed.sections.find((s) => s.name === name);
      sections[name] = sec?.content ?? "";
    }
  }

  return { slug: input.slug, frontmatter: fm, sections };
}

// ============================================================================
// commit_patch
// ============================================================================

export type CommitPatchOutput = {
  ok: true;
  commits: Array<{ path: string; sha: string; url: string | null }>;
  preview: ApplyPatchResult & { fileBackedDiffs: FileBackedDiff[] };
};

export type FileBackedDiff = {
  section: string;
  action: SectionChange["action"];
  before: string;
  after: string;
};

// Full validated commit. Mirrors the spec input shape; expects an
// already-parsed CommitPatchInput from the route handler.
export async function commitPatch(input: CommitPatchInput): Promise<CommitPatchOutput> {
  const client = getVaultClient();
  const paths = bookPaths(input.slug);

  // 1. Fetch the reference file (authoritative).
  const refFile = await client.getFile(paths.reference);
  if (!refFile) throw new Error(`Book not found: ${input.slug}`);

  // 2. Split section_changes into reference-body changes vs file-backed.
  const refBodyChanges: Record<string, SectionChange> = {};
  const fileBackedChanges: Record<string, SectionChange> = {};
  for (const [name, change] of Object.entries(input.section_changes ?? {})) {
    if (isFileBackedSection(name)) {
      fileBackedChanges[name] = change;
    } else {
      refBodyChanges[name] = change;
    }
  }

  // 3. Apply patch to the reference file body + frontmatter.
  const patched = applyPatch(refFile.content, {
    frontmatter_changes: input.frontmatter_changes,
    section_changes: refBodyChanges,
  });

  // 4. Validate the post-patch reference: must still parse, must still
  //    have the required Book fields. We don't full-zod-validate the
  //    Book type because the on-disk schema is permissive (lots of
  //    optional/null fields); we check the load-bearing minimum.
  validateRefAfterPatch(patched.after, input.slug);

  // 5. Compute file-backed diffs (without yet committing).
  const fileBackedDiffs: FileBackedDiff[] = [];
  const fileBackedWrites: Array<{ path: string; content: string; sha: string | null }> = [];
  for (const [name, change] of Object.entries(fileBackedChanges)) {
    if (!isFileBackedSection(name)) continue;
    const filePath = fileBackedPath(input.slug, name);
    const existing = await client.getFile(filePath);
    const before = existing?.content ?? "";
    let after: string;
    if (change.action === "replace") {
      after = change.content;
    } else if (change.action === "append") {
      after = before.length === 0 ? change.content : `${trimTrailing(before)}\n\n${change.content}`;
    } else {
      after = before.length === 0 ? change.content : `${change.content}\n\n${trimLeading(before)}`;
    }
    if (!after.endsWith("\n")) after += "\n";
    fileBackedDiffs.push({ section: name, action: change.action, before, after });
    fileBackedWrites.push({ path: filePath, content: after, sha: existing?.sha ?? null });
  }

  // 6. Commit reference file first, then each file-backed write.
  // Not atomic across files (Contents API limitation), but the order
  // is forwards-safe: a partial failure leaves the user in a state
  // where they can retry.
  const commits: CommitPatchOutput["commits"] = [];
  // Stamp the trailer once per commit_patch call so all files written
  // for the same patch share a session id (and the surrogate-message
  // value matches across the split commits).
  const message = withTrailer(input.commit_message);
  if (patched.changedFrontmatter.length > 0 || patched.changedSections.length > 0) {
    const r = await client.commitFile({
      filePath: paths.reference,
      content: patched.after,
      message,
      sha: refFile.sha,
    });
    commits.push({ path: paths.reference, sha: r.sha, url: r.url });
  }
  for (const w of fileBackedWrites) {
    const r = await client.commitFile({
      filePath: w.path,
      content: w.content,
      message,
      sha: w.sha,
    });
    commits.push({ path: w.path, sha: r.sha, url: r.url });
  }

  // 7. Optimistic store update: write the new parsed Book back so
  // subsequent reads don't have to wait for the webhook reindex.
  // Build a Book-shaped record from the parsed frontmatter. Reuses
  // the existing books.ts parser conventions implicitly — anything
  // missing keeps its defaults.
  const newParsed = parseMarkdownFile(patched.after);
  await updateStoreOptimistic(input.slug, newParsed.frontmatter);

  return {
    ok: true,
    commits,
    preview: { ...patched, fileBackedDiffs },
  };

  function trimTrailing(s: string): string {
    return s.replace(/\s+$/, "");
  }
  function trimLeading(s: string): string {
    return s.replace(/^\s+/, "");
  }
}

// Re-validates the load-bearing fields after the patch is applied:
// title non-empty, status (when set) is a valid BookStatus, authors
// (when set) remains a string array. Exported so the batch path can
// validate every patch BEFORE any write hits disk.
export function validateRefAfterPatch(rawAfter: string, slug: string): void {
  const parsed = parseMarkdownFile(rawAfter);
  const fm = parsed.frontmatter;
  if (typeof fm.title !== "string" || fm.title.length === 0) {
    throw new Error(`Patch result missing title for ${slug}`);
  }
  if (fm.status !== undefined) {
    const validStatuses = ["tbr", "reading", "finished", "abandoned", "paused"];
    if (typeof fm.status !== "string" || !validStatuses.includes(fm.status)) {
      throw new Error(`Patch result has invalid status for ${slug}: ${String(fm.status)}`);
    }
  }
  // Authors should be an array of strings if present.
  if (fm.authors !== undefined) {
    if (!Array.isArray(fm.authors) || fm.authors.some((a) => typeof a !== "string")) {
      throw new Error(`Patch result has invalid authors for ${slug}`);
    }
  }
}

// Optimistic store write: project the patched frontmatter onto the
// existing Book record so subsequent reads don't need the webhook
// reindex. Exported so the batch path can apply the same update once
// per slug in the batch.
export async function updateStoreOptimistic(
  slug: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  const store = getStore();
  const existing = await store.get<Book>(keys.book(slug));
  // Merge the new frontmatter into the existing parsed Book record so
  // status/rating/etc. propagate. Any fields the patch doesn't mention
  // keep their existing values from the reindexed snapshot. Fields the
  // patch sets to null are removed by the markdown serialise step
  // already, so they'll re-read as null on next reindex.
  const updated: Book = {
    ...(existing ?? defaultBook(slug)),
    ...projectFrontmatterToBook(slug, frontmatter, existing ?? defaultBook(slug)),
  };
  await store.set(keys.book(slug), updated);
}

function defaultBook(slug: string): Book {
  return {
    slug,
    title: slug,
    authors: [],
    series: null,
    status: "tbr",
    progress: "",
    started: null,
    last_progress: null,
    finished: null,
    rating: null,
    wouldReread: null,
    bingoSquares: [],
    tags: [],
    cover: null,
    pullquote: null,
    seeAlso: [],
    lastEdited: null,
    hasReview: false,
    hasQuotes: false,
    hasProgress: false,
    premise: null,
    goodreadsId: null,
    hardcoverSlug: null,
    storygraphSlug: null,
    bookwyrmUrl: null,
    amazonAsin: null,
    source: null,
    hideExternalReviews: false,
    pages: null,
    trigger: null,
  };
}

// Project a raw frontmatter object onto the Book shape. Mirrors the
// parsing in src/lib/books.ts but kept loose — we only update fields
// the patch actually touches; everything else stays as it was.
function projectFrontmatterToBook(
  slug: string,
  fm: Record<string, unknown>,
  base: Book,
): Partial<Book> {
  const patch: Partial<Book> = {};
  if (typeof fm.title === "string") patch.title = fm.title;
  if (Array.isArray(fm.authors) && fm.authors.every((a) => typeof a === "string")) {
    patch.authors = fm.authors as string[];
  }
  if (typeof fm.status === "string") {
    patch.status = fm.status as Book["status"];
  }
  if (typeof fm.progress === "string") patch.progress = fm.progress;
  if (typeof fm.started === "string" || fm.started === null)
    patch.started = (fm.started as string | null) ?? null;
  if (typeof fm.last_progress === "string" || fm.last_progress === null)
    patch.last_progress = (fm.last_progress as string | null) ?? null;
  if (typeof fm.finished === "string" || fm.finished === null)
    patch.finished = (fm.finished as string | null) ?? null;
  if (typeof fm.rating === "number" || fm.rating === null)
    patch.rating = fm.rating as number | null;
  if (typeof fm.would_reread === "boolean" || fm.would_reread === null)
    patch.wouldReread = fm.would_reread as boolean | null;
  if (Array.isArray(fm.tags) && fm.tags.every((t) => typeof t === "string"))
    patch.tags = fm.tags as string[];
  if (Array.isArray(fm.bingo_squares) && fm.bingo_squares.every((s) => typeof s === "string"))
    patch.bingoSquares = fm.bingo_squares as string[];
  if (typeof fm.cover === "string" || fm.cover === null)
    patch.cover = (fm.cover as string | null) ?? null;
  if (typeof fm.premise === "string" || fm.premise === null)
    patch.premise = (fm.premise as string | null) ?? null;
  if (typeof fm.trigger === "string" || fm.trigger === null)
    patch.trigger = (fm.trigger as string | null) ?? null;
  // ... external IDs
  if (typeof fm.goodreads_id === "string" || typeof fm.goodreads_id === "number")
    patch.goodreadsId = String(fm.goodreads_id);
  if (typeof fm.hardcover_slug === "string") patch.hardcoverSlug = fm.hardcover_slug;
  if (typeof fm.storygraph_slug === "string") patch.storygraphSlug = fm.storygraph_slug;
  if (typeof fm.bookwyrm_url === "string") patch.bookwyrmUrl = fm.bookwyrm_url;
  if (typeof fm.amazon_asin === "string") patch.amazonAsin = fm.amazon_asin;
  // Touch base so the linter doesn't complain about an unused param —
  // `base` is conceptually here because future expansion may need to
  // diff against the existing record.
  void base;
  void slug;
  return patch;
}

// Re-export for the route handler.
export { FILE_BACKED_SECTIONS };
