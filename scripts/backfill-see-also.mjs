#!/usr/bin/env node
// Walks the vault and writes `see_also` cross-references for each
// book based on series + author peers. Pure derivation — no external
// lookups, no network. Safe to re-run; merges new entries with any
// existing see_also list, dedupes, caps at MAX_SEE_ALSO per book.
//
// Heuristic, in order of preference:
//   1. Same series — adjacent books (previous and next by series #)
//   2. Same series — any other books in series, capped
//   3. Same author — up to two books by same author (excluding any
//      already added via series)
//
// Defaults to **dry-run** (prints a diff summary). Pass `--apply` to
// write back to the vault. Each file is rewritten with the new
// frontmatter; the body is preserved verbatim. When stdin is a TTY
// and the dry-run has pending changes, prompts to apply them so the
// computed changeset isn't thrown away. Non-TTY stdin never prompts.
//
// Usage:
//   node scripts/backfill-see-also.mjs --vault PATH [--apply] [--max N]

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const MAX_SEE_ALSO = Number(argv.max ?? 4);

await main();

async function main() {
  const books = await readVault(VAULT);
  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${books.length}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY (will rewrite files)" : "dry-run"}\n\n`);

  // Group helpers — same-series mates (one entry per series the book
  // belongs to; multi-series books like "Discworld, #32; Tiffany Aching #2"
  // land under both "Discworld" and "Tiffany Aching"), same-author mates.
  const bySeriesName = new Map(); // series-name (no #N) → [book...]
  const byAuthor = new Map(); // first-author → [book...]
  for (const b of books) {
    for (const m of parseSeriesMemberships(b.series)) {
      const arr = bySeriesName.get(m.name) ?? [];
      arr.push(b);
      bySeriesName.set(m.name, arr);
    }
    const author = b.authors[0];
    if (author) {
      const arr = byAuthor.get(author) ?? [];
      arr.push(b);
      byAuthor.set(author, arr);
    }
  }

  // Per-book additions.
  let touched = 0;
  let totalAdded = 0;
  // Pending writes collected during the dry-run; fired by maybePromptApply
  // at the end so the computed changeset isn't redone after a yes.
  const pending = [];
  for (const book of books) {
    const additions = computeAdditions(book, { bySeriesName, byAuthor });
    if (additions.length === 0) continue;

    const existingSet = new Set(book.seeAlso);
    const merged = [...book.seeAlso];
    for (const slug of additions) {
      if (merged.length >= MAX_SEE_ALSO) break;
      if (existingSet.has(slug)) continue;
      merged.push(slug);
      existingSet.add(slug);
    }

    const newAdditions = merged.length - book.seeAlso.length;
    if (newAdditions === 0) continue;

    touched++;
    totalAdded += newAdditions;
    process.stdout.write(
      `${book.slug.padEnd(40)} +${newAdditions}: ${merged.slice(book.seeAlso.length).join(", ")}\n`,
    );
    const bookPath = book.path;
    pending.push(() => writeUpdatedSeeAlso(bookPath, merged));
  }

  process.stderr.write(`\n${touched} books would gain see_also entries (${totalAdded} total)\n`);

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "see_also additions",
    doApply: async () => {
      for (const write of pending) await write();
      process.stderr.write(`wrote ${pending.length} books\n`);
    },
  });
}

function computeAdditions(book, { bySeriesName, byAuthor }) {
  const adds = [];
  const myMemberships = parseSeriesMemberships(book.series);

  // 1. Same-series neighbours, per series the book belongs to. For
  //    each series membership: emit prev + next by index in that
  //    series, then any other mates from that series.
  for (const own of myMemberships) {
    if (adds.length >= MAX_SEE_ALSO) break;
    const seriesMates = bySeriesName.get(own.name) ?? [];
    const mates = seriesMates
      .filter((m) => m.slug !== book.slug)
      .map((m) => {
        // The mate's index WITHIN THIS SERIES (mate may belong to
        // multiple series with different indexes).
        const mm = parseSeriesMemberships(m.series).find((x) => x.name === own.name);
        return { slug: m.slug, idx: mm?.index ?? null };
      })
      .sort((a, b) => (a.idx ?? 9999) - (b.idx ?? 9999));

    if (own.index !== null) {
      const before = mates.filter((m) => m.idx !== null && m.idx < own.index).slice(-1);
      const after = mates.filter((m) => m.idx !== null && m.idx > own.index).slice(0, 1);
      for (const m of [...before, ...after]) {
        if (!adds.includes(m.slug)) adds.push(m.slug);
        if (adds.length >= MAX_SEE_ALSO) break;
      }
    }
    for (const m of mates) {
      if (adds.length >= MAX_SEE_ALSO) break;
      if (!adds.includes(m.slug)) adds.push(m.slug);
    }
  }

  // 2. Same-author mates (skipping ones already from series).
  const author = book.authors[0];
  if (author && adds.length < MAX_SEE_ALSO) {
    const mates = (byAuthor.get(author) ?? [])
      .filter((m) => m.slug !== book.slug && !adds.includes(m.slug))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    for (const m of mates) {
      adds.push(m.slug);
      if (adds.length >= MAX_SEE_ALSO) break;
    }
  }

  return adds;
}

// Parse a series field into one or more memberships. A book like
// "Discworld, #32; Tiffany Aching #2" returns two memberships;
// "Realm of the Elderlings #3" returns one. Mirrors the lib helper
// in src/lib/books.ts:parseSeriesMemberships — kept hand-synced so
// the script stays self-contained.
function parseSeriesMemberships(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  const out = [];
  for (const segment of raw.split(";")) {
    const cleaned = segment.replace(/^\s*,?\s*|\s*,?\s*$/g, "");
    if (cleaned.length === 0) continue;
    const m = /^(.+?)\s*,?\s*#(\d+(?:\.\d+)?)\s*$/.exec(cleaned);
    if (m) {
      const idx = Number(m[2]);
      out.push({
        name: m[1].replace(/\s*,\s*$/, "").trim(),
        index: Number.isFinite(idx) ? idx : null,
      });
    } else {
      out.push({ name: cleaned, index: null });
    }
  }
  return out;
}

async function readVault(vaultDir) {
  const dirents = await fs.readdir(vaultDir, { withFileTypes: true });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);
  const out = [];
  for (const slug of slugs) {
    const refPath = path.join(vaultDir, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refPath, "utf8");
    } catch {
      continue;
    }
    const { data } = matter(raw);
    out.push({
      slug,
      path: refPath,
      title: typeof data.title === "string" ? data.title : slug,
      authors: Array.isArray(data.authors) ? data.authors.filter((a) => typeof a === "string") : [],
      series: typeof data.series === "string" ? data.series : null,
      seeAlso: Array.isArray(data.see_also)
        ? data.see_also.filter((s) => typeof s === "string")
        : [],
    });
  }
  return out;
}

// Rewrite the see_also line in-place — preserve the rest of the file
// byte-for-byte. Looking for the exact line `see_also: [...]` (or
// `see_also: []`) and substituting. If the line isn't found, append
// it before the closing `---` of the frontmatter.
async function writeUpdatedSeeAlso(filePath, slugs) {
  const raw = await fs.readFile(filePath, "utf8");
  const newLine = `see_also: [${slugs.map(quoteIfNeeded).join(", ")}]`;
  const seeAlsoRe = /^see_also:.*$/m;
  let updated;
  if (seeAlsoRe.test(raw)) {
    updated = raw.replace(seeAlsoRe, newLine);
  } else {
    // Insert before the closing frontmatter delimiter. Match the
    // SECOND `---` (the first is the opener). The `g` flag is
    // critical — without it, `replace` only fires once, on the
    // opener, and never reaches the closer.
    const frontmatterClose = /^---\s*$/gm;
    let count = 0;
    updated = raw.replace(frontmatterClose, () => {
      count++;
      return count === 2 ? `${newLine}\n---` : "---";
    });
  }
  await fs.writeFile(filePath, updated, "utf8");
}

function quoteIfNeeded(value) {
  if (typeof value !== "string") return JSON.stringify(value);
  const needsQuote = /[:#@!&*%?>|"'`{}[\],\s]/.test(value) || /^[+-]?\d/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply") out.apply = true;
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
