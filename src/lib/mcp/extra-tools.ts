import { z } from "zod";
import yaml from "js-yaml";
import { getVaultClient } from "../github";
import { getStore, keys } from "../store";
import { bookPaths } from "./book-paths";
import { withTrailer } from "./trailer";

// Optional v1 tools — the deferred-but-likely surfaces from the spec.
// Added as separate tool functions so the agent can adopt them
// incrementally; both go through the same vault client + optimistic
// store update pattern as commit_patch.
//
// These are NOT exposed in the /admin agent's propose_patch flow
// because they introduce a different output shape (no diff to preview
// — they create a new file). Wired into the MCP HTTP endpoint only;
// surfacing them in /admin is a follow-up.

// ============================================================================
// create_book
// ============================================================================

export const createBookInputSchema = {
  slug: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_-][A-Za-z0-9_\- ]*$/, {
      message: "Slug must be a directory-safe name (alphanumerics, dashes, underscores, spaces)",
    })
    .describe("Vault directory name for the new book (PascalCase by convention)"),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  status: z.enum(["tbr", "reading", "finished", "abandoned", "paused"]).default("tbr"),
  started: z.string().nullable().optional(),
  finished: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  tags: z.array(z.string()).optional(),
  cover: z.string().nullable().optional(),
  commit_message: z.string().min(1),
};

const createBookValidator = z.object(createBookInputSchema);

export type CreateBookInput = z.infer<typeof createBookValidator>;

export type CreateBookResult = {
  ok: true;
  slug: string;
  commit: { path: string; sha: string; url: string | null };
};

export async function createBook(input: CreateBookInput): Promise<CreateBookResult> {
  const validated = createBookValidator.parse(input);
  const client = getVaultClient();
  const paths = bookPaths(validated.slug);

  // Refuse to overwrite an existing book directory. Easier to require
  // the caller to pick a different slug than to silently merge content.
  if (await client.exists(paths.reference)) {
    throw new Error(`Book already exists: ${validated.slug}`);
  }

  // Build the frontmatter object. Drop undefined/empty optionals so
  // the YAML output is clean.
  const fm: Record<string, unknown> = {
    title: validated.title,
    authors: validated.authors,
    status: validated.status,
  };
  if (validated.started !== undefined) fm.started = validated.started;
  if (validated.finished !== undefined) fm.finished = validated.finished;
  if (validated.rating !== undefined) fm.rating = validated.rating;
  if (validated.tags && validated.tags.length > 0) fm.tags = validated.tags;
  if (validated.cover !== undefined) fm.cover = validated.cover;

  const content = `---\n${yaml.dump(fm, { lineWidth: 1000, noRefs: true })}---\n`;

  const result = await client.commitFile({
    filePath: paths.reference,
    content,
    message: withTrailer(validated.commit_message),
    sha: null,
  });

  // Optimistic store update: write a minimal Book record so list_books
  // surfaces it before the next reindex.
  const store = getStore();
  await store.set(keys.book(validated.slug), {
    slug: validated.slug,
    title: validated.title,
    authors: validated.authors,
    series: null,
    status: validated.status,
    progress: "",
    started: validated.started ?? null,
    last_progress: null,
    finished: validated.finished ?? null,
    rating: validated.rating ?? null,
    wouldReread: null,
    bingoSquares: [],
    tags: validated.tags ?? [],
    cover: validated.cover ?? null,
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
    source: null,
    hideExternalReviews: false,
  });
  await store.sadd(keys.booksIndex(), validated.slug);

  return {
    ok: true,
    slug: validated.slug,
    commit: { path: paths.reference, sha: result.sha, url: result.url },
  };
}

// ============================================================================
// append_log_entry
// ============================================================================
//
// Appends a non-book event to `_meta/log.md`. The schema:
//
//   ## YYYY-MM-DD
//
//   - **Kind** — Body text.
//
// Where kind is one of: Note, Tbr, Reread, Progress, Committed.
// Multiple bullets per date are allowed; new entries are slotted under
// the matching date heading or a fresh one if none exists.

export const appendLogEntryInputSchema = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO YYYY-MM-DD"),
  kind: z.enum(["Note", "Tbr", "Reread", "Progress", "Committed"]),
  body: z.string().min(1),
  commit_message: z.string().min(1),
};

const appendLogEntryValidator = z.object(appendLogEntryInputSchema);

export type AppendLogEntryInput = z.infer<typeof appendLogEntryValidator>;

export type AppendLogEntryResult = {
  ok: true;
  date: string;
  kind: string;
  commit: { path: string; sha: string; url: string | null };
};

export async function appendLogEntry(input: AppendLogEntryInput): Promise<AppendLogEntryResult> {
  const validated = appendLogEntryValidator.parse(input);
  const client = getVaultClient();
  const filePath = "_meta/log.md";
  const existing = await client.getFile(filePath);

  const newContent = upsertLogEntry({
    existing: existing?.content ?? "",
    date: validated.date,
    kind: validated.kind,
    body: validated.body,
  });

  const result = await client.commitFile({
    filePath,
    content: newContent,
    message: withTrailer(validated.commit_message),
    sha: existing?.sha ?? null,
  });

  return {
    ok: true,
    date: validated.date,
    kind: validated.kind,
    commit: { path: filePath, sha: result.sha, url: result.url },
  };
}

// Inserts a new bullet under the matching date heading. If no heading
// exists, creates one in date-descending order (newest first). The
// /log render reads this file and merges with frontmatter-derived
// events; here we just keep the file's own ordering tidy.
export function upsertLogEntry(args: {
  existing: string;
  date: string;
  kind: string;
  body: string;
}): string {
  const bullet = `- **${args.kind}** — ${args.body.trim()}`;
  const heading = `## ${args.date}`;

  if (args.existing.length === 0) {
    return `${heading}\n\n${bullet}\n`;
  }

  // Try to find the matching heading.
  const lines = args.existing.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === heading);
  if (headingIdx >= 0) {
    // Find the next blank line followed by content, or the next heading.
    // Insert the bullet right after the heading (and any blank line
    // immediately following it).
    let insertAt = headingIdx + 1;
    if (insertAt < lines.length && lines[insertAt].trim() === "") insertAt++;
    // Skip past existing bullets to keep new entries at the bottom of
    // the same date's bullet list.
    while (insertAt < lines.length && lines[insertAt].trim().startsWith("- ")) {
      insertAt++;
    }
    lines.splice(insertAt, 0, bullet);
    return lines.join("\n");
  }

  // No matching heading. Insert in date-descending order (newest
  // first). Walk existing headings; place ours above the first
  // heading whose date is older than ours.
  const headingRe = /^## (\d{4}-\d{2}-\d{2})\s*$/;
  let inserted = false;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (!inserted && m && m[1] < args.date) {
      out.push(heading, "", bullet, "");
      inserted = true;
    }
    out.push(lines[i]);
  }
  if (!inserted) {
    // All existing dates are newer (or there are no date headings).
    // Append at the end.
    if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
    out.push(heading, "", bullet, "");
  }
  let result = out.join("\n");
  if (!result.endsWith("\n")) result += "\n";
  return result;
}
