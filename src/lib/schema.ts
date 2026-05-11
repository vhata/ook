import type { Book } from "./types";

// Auto-documentation of the render-side frontmatter schema. The Book
// type is the typed projection of the vault's frontmatter; this
// summary walks every parsed Book record and reports which fields are
// populated, how broadly, and a few sample values per field.
//
// Pure derivation — no network, no I/O. Powers /schema.

export type SchemaFieldKind = "string" | "number" | "boolean" | "array" | "object";

export type SchemaField = {
  name: string;
  kind: SchemaFieldKind;
  populated: number;
  total: number;
  examples: string[];
  note?: string;
};

export type SchemaSummary = {
  total: number;
  fields: SchemaField[];
};

// Per-field accessor: returns null when the field is "unpopulated"
// (intent-equivalent to "missing"), or a serialisable example value
// when populated. Each entry can also override `kind` for non-default
// shapes (boolean fields are treated as string in the summary so the
// example column reads "true (147) · false (2)").
type FieldDef = {
  name: string;
  kind: SchemaFieldKind;
  note?: string;
  pluck: (book: Book) => unknown;
  // Optional custom presence check — defaults to "value is truthy
  // (non-null, non-empty string, non-empty array)".
  populated?: (value: unknown) => boolean;
  // Optional custom rendering for example values.
  formatExample?: (value: unknown) => string;
};

const FIELDS: FieldDef[] = [
  { name: "title", kind: "string", pluck: (b) => b.title },
  {
    name: "authors",
    kind: "array",
    pluck: (b) => b.authors,
    formatExample: (v) => (Array.isArray(v) ? v.join(", ") : String(v)),
  },
  { name: "series", kind: "string", pluck: (b) => b.series },
  {
    name: "status",
    kind: "string",
    pluck: (b) => b.status,
    note: "Enum: tbr, reading, finished, abandoned, paused.",
  },
  { name: "progress", kind: "string", pluck: (b) => b.progress },
  { name: "started", kind: "string", note: "YYYY-MM-DD", pluck: (b) => b.started },
  { name: "finished", kind: "string", note: "YYYY-MM-DD", pluck: (b) => b.finished },
  { name: "rating", kind: "number", pluck: (b) => b.rating },
  {
    name: "wouldReread",
    kind: "boolean",
    pluck: (b) => b.wouldReread,
    populated: (v) => v !== null,
  },
  {
    name: "bingo_squares",
    kind: "array",
    pluck: (b) => b.bingoSquares,
    formatExample: (v) => (Array.isArray(v) ? v.join(", ") : String(v)),
  },
  {
    name: "tags",
    kind: "array",
    pluck: (b) => b.tags,
    formatExample: (v) => (Array.isArray(v) ? v.join(", ") : String(v)),
  },
  { name: "cover", kind: "string", pluck: (b) => b.cover },
  {
    name: "pullquote",
    kind: "object",
    pluck: (b) => b.pullquote,
    formatExample: (v) => {
      if (v && typeof v === "object" && "text" in v) {
        return String((v as { text: unknown }).text ?? "");
      }
      return "";
    },
  },
  {
    name: "premise",
    kind: "string",
    note: "Tier-0 back-cover blurb. Always rendered when set.",
    pluck: (b) => b.premise,
  },
  {
    name: "see_also",
    kind: "array",
    pluck: (b) => b.seeAlso,
    formatExample: (v) => (Array.isArray(v) ? v.join(", ") : String(v)),
  },
  { name: "goodreads_id", kind: "string", pluck: (b) => b.goodreadsId },
  { name: "hardcover_slug", kind: "string", pluck: (b) => b.hardcoverSlug },
  { name: "storygraph_slug", kind: "string", pluck: (b) => b.storygraphSlug },
  { name: "bookwyrm_url", kind: "string", pluck: (b) => b.bookwyrmUrl },
  {
    name: "source",
    kind: "string",
    pluck: (b) => b.source,
    note: "Enum: goodreads, media-list, manual.",
  },
  // Derived / file-presence fields kept at the foot.
  {
    name: "review.md",
    kind: "boolean",
    note: "Tier-1 reveal source on the per-book page.",
    pluck: (b) => b.hasReview,
    populated: (v) => v === true,
  },
  {
    name: "quotes.md",
    kind: "boolean",
    note: "Tier-1 reveal source on the per-book page.",
    pluck: (b) => b.hasQuotes,
    populated: (v) => v === true,
  },
  {
    name: "summary.md",
    kind: "boolean",
    note: "Tier-2 plot recap folded into the deep-notes payload.",
    pluck: (b) => b.hasSummary,
    populated: (v) => v === true,
  },
];

const EXAMPLE_LIMIT = 3;
const EXAMPLE_TRUNCATE = 60;

export function getSchemaSummary(books: Book[]): SchemaSummary {
  const fields: SchemaField[] = [];
  for (const def of FIELDS) {
    let populated = 0;
    const examples: string[] = [];
    const seen = new Set<string>();
    for (const book of books) {
      const value = def.pluck(book);
      const isPopulated = def.populated ? def.populated(value) : defaultPopulated(value);
      if (!isPopulated) continue;
      populated++;

      if (examples.length >= EXAMPLE_LIMIT) continue;
      const formatted = def.formatExample ? def.formatExample(value) : defaultFormatExample(value);
      const truncated = truncate(formatted, EXAMPLE_TRUNCATE);
      if (truncated && !seen.has(truncated)) {
        examples.push(truncated);
        seen.add(truncated);
      }
    }
    fields.push({
      name: def.name,
      kind: def.kind,
      populated,
      total: books.length,
      examples,
      note: def.note,
    });
  }
  // Sort by coverage descending, then by name. Keeps the most-used
  // fields at the top — useful at-a-glance for "what's the schema
  // mostly look like."
  fields.sort((a, b) => b.populated - a.populated || a.name.localeCompare(b.name));
  return { total: books.length, fields };
}

function defaultPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return true;
}

function defaultFormatExample(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit - 1) + "…";
}
