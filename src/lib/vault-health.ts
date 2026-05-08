import { getAllBooks } from "./books";
import type { Book } from "./types";

// Pure-derivation health checker. Walks every Book record from the
// vault reader and surfaces fields that are conventionally expected
// but missing, plus broken cross-references.
//
// Used both by the on-site `/vault-health` page and the
// `scripts/vault-lint.mjs` CLI — same checks, two surfaces.

export type Severity = "error" | "warning" | "info";

export type Finding = {
  slug: string;
  title: string;
  // Source the book came from — drives the priority panels on
  // /vault-health. Goodreads-sourced books with gaps are the
  // highest-value check-in target since the user has personal
  // history attached but might be missing the date / rating.
  source: "goodreads" | "media-list" | "manual" | null;
  severity: Severity;
  field: string;
  message: string;
};

export type HealthReport = {
  books: number;
  findings: Finding[];
  // Findings grouped by severity for quick rendering / summary.
  bySeverity: { error: number; warning: number; info: number };
  // Findings grouped by field for the renderer's faceted view.
  byField: Record<string, number>;
};

export async function getHealthReport(): Promise<HealthReport> {
  const books = await getAllBooks();
  const slugSet = new Set(books.map((b) => b.slug));
  const findings: Finding[] = [];

  for (const book of books) {
    findings.push(...checkBook(book, slugSet));
  }
  findings.push(...checkCorpus(books));

  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byField: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity]++;
    byField[f.field] = (byField[f.field] ?? 0) + 1;
  }

  return { books: books.length, findings, bySeverity, byField };
}

// Per-book checks. Severity choices are deliberate:
//   - error:   the field is required for the book to render correctly
//              (title, valid status). Without these the renderer falls
//              back to defaults that may hide bugs.
//   - warning: the field is conventionally expected for this book's
//              state — e.g. a finished book with no `finished` date,
//              or a book with bingo squares but no rating. Render
//              still works, but the value is suspicious.
//   - info:    the field is optional and missing — opportunities for
//              enrichment, not problems. Mostly hidden by default in
//              the UI; surfaced for the curious.

export function checkBook(book: Book, allSlugs: Set<string>): Finding[] {
  const out: Finding[] = [];
  const push = (severity: Severity, field: string, message: string) =>
    out.push({
      slug: book.slug,
      title: book.title,
      source: book.source,
      severity,
      field,
      message,
    });

  // Required fields.
  // (Title can legitimately equal the slug — that's the vault convention.
  // The render layer falls back to slug for missing titles, which makes
  // it impossible to detect the missing-title case from the parsed
  // record. The CLI script — which sees raw frontmatter — surfaces it
  // there. Skip here.)
  if (book.authors.length === 0) {
    push("warning", "authors", "No authors listed.");
  }

  // Status-conditional checks.
  if (book.status === "finished") {
    if (!book.finished) {
      push(
        "warning",
        "finished",
        "Status is finished but no finished date — won't appear in /log, /stats, or recently-finished.",
      );
    }
    if (book.rating === null) {
      push("info", "rating", "Finished but no rating.");
    }
    if (!book.hasReview) {
      push("info", "review", "Finished but no review.md.");
    }
  } else if (book.status === "reading") {
    if (!book.started) {
      push("warning", "started", "Status is reading but no started date.");
    }
  } else if (book.status === "abandoned") {
    if (!book.started) {
      push("info", "started", "Abandoned but no started date.");
    }
  }

  // Bingo-bound books should generally have ratings + finished dates.
  if (book.bingoSquares.length > 0 && book.status === "finished" && book.rating === null) {
    push("info", "rating", `Claims bingo ${book.bingoSquares.join(",")} but no rating.`);
  }

  // Cover suggestions.
  if (!book.cover) {
    push("info", "cover", "No cover URL — using procedural placeholder.");
  }

  // Cross-reference checks.
  for (const other of book.seeAlso) {
    if (!allSlugs.has(other)) {
      push("error", "see_also", `Broken see_also reference: "${other}" — no such book.`);
    }
  }

  // Future-self note: when more disciplines settle, encode them here.
  // The lint rule on file-write is mechanizable; this is for
  // semantic shape that lint can't see.

  return out;
}

// Corpus-level checks — see across the whole vault rather than per-book.
// Surfaces graph-shape findings: books nothing references, asymmetric
// see_also pairs.
export function checkCorpus(books: Book[]): Finding[] {
  const out: Finding[] = [];
  const push = (book: Book, severity: Severity, field: string, message: string) =>
    out.push({
      slug: book.slug,
      title: book.title,
      source: book.source,
      severity,
      field,
      message,
    });

  // Build the inbound see_also graph: which books reference this slug.
  const inbound = new Map<string, Set<string>>();
  for (const book of books) {
    for (const ref of book.seeAlso) {
      const set = inbound.get(ref) ?? new Set<string>();
      set.add(book.slug);
      inbound.set(ref, set);
    }
  }

  for (const book of books) {
    const back = inbound.get(book.slug) ?? new Set<string>();

    // Orphan: nothing references this book and it isn't bound to a
    // bingo square. Likely fine — sometimes books just stand alone —
    // but worth surfacing as an enrichment opportunity.
    if (back.size === 0 && book.bingoSquares.length === 0) {
      push(
        book,
        "info",
        "orphan",
        "No incoming see_also references and no bingo binding — disconnected from the graph.",
      );
    }

    // Asymmetric see_also: another book points here, but this one
    // doesn't point back. Reciprocity isn't required, but the
    // imbalance is often unintentional after a backfill pass.
    const outbound = new Set(book.seeAlso);
    for (const referrer of back) {
      if (!outbound.has(referrer)) {
        push(
          book,
          "info",
          "see_also",
          `Asymmetric: "${referrer}" links here, but this book doesn't link back.`,
        );
      }
    }
  }

  return out;
}
