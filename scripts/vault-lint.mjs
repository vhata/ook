#!/usr/bin/env node
// vault-lint — walks the vault and prints findings for any book whose
// frontmatter is missing fields the renderer / disciplines expect.
//
// Same checks as the /vault-health page (src/lib/vault-health.ts), but
// runs locally as a CLI so you can audit before pushing or right after
// a bulk import. Read-only — never writes to the vault.
//
// Usage:
//   node scripts/vault-lint.mjs [--vault PATH] [--severity error|warning|info]
//                               [--field FIELDNAME] [--json]
//
// Defaults:
//   - vault: $BOOKS_DIR or ./vault
//   - severity: warning (shows warning + error)
//   - human-readable output

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const SEVERITY_FLOOR = argv.severity ?? "warning";
const FIELD_FILTER = argv.field ?? null;
const JSON_OUT = !!argv.json;

await main();

async function main() {
  const books = await readAllBooks(VAULT);
  const slugSet = new Set(books.map((b) => b.slug));
  const findings = books.flatMap((b) => checkBook(b, slugSet)).concat(checkCorpus(books));

  let filtered = findings.filter((f) => severityRank(f.severity) >= severityRank(SEVERITY_FLOOR));
  if (FIELD_FILTER) filtered = filtered.filter((f) => f.field === FIELD_FILTER);

  if (JSON_OUT) {
    process.stdout.write(
      JSON.stringify({ books: books.length, findings: filtered }, null, 2) + "\n",
    );
    return;
  }

  // Human output: header summary, then findings grouped by slug.
  const bySlug = new Map();
  for (const f of filtered) {
    const arr = bySlug.get(f.slug) ?? [];
    arr.push(f);
    bySlug.set(f.slug, arr);
  }

  const sevCounts = countBy(filtered, (f) => f.severity);
  process.stdout.write(`vault: ${VAULT}\n`);
  process.stdout.write(`books: ${books.length}\n`);
  process.stdout.write(`findings: ${filtered.length}`);
  if (filtered.length > 0) {
    process.stdout.write(
      ` (${["error", "warning", "info"]
        .filter((s) => sevCounts[s])
        .map((s) => `${s}=${sevCounts[s]}`)
        .join(" ")})`,
    );
  }
  process.stdout.write("\n");
  process.stdout.write(`books with findings: ${bySlug.size}\n`);
  process.stdout.write("\n");

  if (filtered.length === 0) {
    process.stdout.write("vault is clean ✓\n");
    return;
  }

  const slugsSorted = [...bySlug.keys()].sort();
  for (const slug of slugsSorted) {
    const items = bySlug.get(slug);
    const title = items[0].title ?? slug;
    process.stdout.write(`${title}  (${slug})\n`);
    for (const f of items) {
      const prefix = f.severity === "error" ? "  ✗ " : f.severity === "warning" ? "  ! " : "  · ";
      process.stdout.write(`${prefix}${f.field.padEnd(12)} ${f.message}\n`);
    }
    process.stdout.write("\n");
  }
}

// Mirrors src/lib/vault-health.ts:checkBook. Kept in sync by hand
// rather than imported to avoid pulling the TS render layer into a
// node script. Two surfaces, one ruleset.
function checkBook(book, allSlugs) {
  const out = [];
  const push = (severity, field, message) =>
    out.push({ slug: book.slug, title: book.title, severity, field, message });

  // Title check (CLI-only — we have access to the raw frontmatter
  // here, so we can tell when the field was actually missing rather
  // than just defaulted to the slug).
  if (book.titleMissing) {
    push("error", "title", "Missing title field; renderer falls back to slug.");
  }
  if (book.authors.length === 0) {
    push("warning", "authors", "No authors listed.");
  }

  if (book.status === "finished") {
    if (!book.finished) {
      push(
        "warning",
        "finished",
        "Status is finished but no finished date — won't appear in /log, /stats, or recently-finished.",
      );
    }
    if (book.rating === null) push("info", "rating", "Finished but no rating.");
    if (!book.hasReview) push("info", "review", "Finished but no review.md.");
  } else if (book.status === "reading") {
    if (!book.started) push("warning", "started", "Status is reading but no started date.");
  } else if (book.status === "abandoned") {
    if (!book.started) push("info", "started", "Abandoned but no started date.");
  }

  if (book.bingoSquares.length > 0 && book.status === "finished" && book.rating === null) {
    push("info", "rating", `Claims bingo ${book.bingoSquares.join(",")} but no rating.`);
  }

  if (!book.cover) push("info", "cover", "No cover URL — using procedural placeholder.");

  for (const other of book.seeAlso) {
    if (!allSlugs.has(other)) {
      push("error", "see_also", `Broken see_also reference: "${other}" — no such book.`);
    }
  }

  return out;
}

// Mirrors src/lib/vault-health.ts:checkCorpus. Graph-shape checks that
// per-book inspection can't see — orphans and asymmetric see_also.
function checkCorpus(books) {
  const out = [];
  const push = (book, severity, field, message) =>
    out.push({ slug: book.slug, title: book.title, severity, field, message });

  const inbound = new Map();
  for (const book of books) {
    for (const ref of book.seeAlso) {
      const set = inbound.get(ref) ?? new Set();
      set.add(book.slug);
      inbound.set(ref, set);
    }
  }

  for (const book of books) {
    const back = inbound.get(book.slug) ?? new Set();
    if (back.size === 0 && book.bingoSquares.length === 0) {
      push(
        book,
        "info",
        "orphan",
        "No incoming see_also references and no bingo binding — disconnected from the graph.",
      );
    }
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

async function readAllBooks(vault) {
  let dirents;
  try {
    dirents = await fs.readdir(vault, { withFileTypes: true });
  } catch (e) {
    process.stderr.write(`vault not readable at ${vault}: ${e.message}\n`);
    process.exit(2);
  }
  const slugs = dirents
    .filter(
      (e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "_meta" && e.name !== "bin",
    )
    .map((e) => e.name);

  const out = [];
  for (const slug of slugs) {
    const refFile = path.join(vault, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refFile, "utf8");
    } catch {
      continue; // dir without a reference file — silently skip
    }
    const { data } = matter(raw);
    out.push({
      slug,
      title: typeof data.title === "string" ? data.title : slug,
      titleMissing: typeof data.title !== "string",
      authors: Array.isArray(data.authors) ? data.authors.filter((a) => typeof a === "string") : [],
      status: typeof data.status === "string" ? data.status : "tbr",
      started: parseDateStr(data.started),
      finished: parseDateStr(data.finished),
      rating: typeof data.rating === "number" ? data.rating : null,
      bingoSquares: Array.isArray(data.bingo_squares)
        ? data.bingo_squares.filter((s) => typeof s === "string")
        : [],
      cover: typeof data.cover === "string" ? data.cover : null,
      seeAlso: Array.isArray(data.see_also)
        ? data.see_also.filter((s) => typeof s === "string")
        : [],
      hasReview: await fileExists(path.join(vault, slug, "review.md")),
    });
  }
  return out;
}

function parseDateStr(value) {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function severityRank(s) {
  return s === "error" ? 3 : s === "warning" ? 2 : 1;
}

function countBy(items, key) {
  const out = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") out.json = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}
