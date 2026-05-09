#!/usr/bin/env node
// Extends `see_also` for books with empty or thin entries by ranking
// every other book by tag-Jaccard similarity. Pure derivation from
// corpus tags; companion to `backfill-see-also.mjs` (which uses series
// + author). Run AFTER both tag backfills so peer tags are populated.
//
// Quality bars (conservative — better to skip than to mis-link):
//   - shared tag count    >= MIN_SHARED  (default 3)
//   - Jaccard similarity  >= MIN_JACCARD (default 0.4)
// Books with fewer than MIN_SHARED tags themselves are skipped — the
// signal is too thin to rank candidates against.
//
// Diversity caps so a single heavily-tagged series can't crowd out
// every other recommendation:
//   - At most MAX_PER_SERIES (default 1) entries from any one series.
//   - At most MAX_PER_AUTHOR (default 2) entries from any one author.
//
// Existing see_also entries are preserved; new ones merge in capped
// at MAX_SEE_ALSO (default 4, matches backfill-see-also.mjs).
//
// Defaults to **dry-run**. Pass `--apply` to write.
//
// Usage:
//   node scripts/backfill-see-also-from-tags.mjs [--vault PATH] [--apply]
//                                                [--max N]
//                                                [--min-shared N]
//                                                [--min-jaccard F]
//                                                [--max-per-series N]
//                                                [--max-per-author N]

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const MAX_SEE_ALSO = Number(argv.max ?? 4);
const MIN_SHARED = Number(argv["min-shared"] ?? 3);
const MIN_JACCARD = Number(argv["min-jaccard"] ?? 0.4);
const MAX_PER_SERIES = Number(argv["max-per-series"] ?? 1);
const MAX_PER_AUTHOR = Number(argv["max-per-author"] ?? 2);

await main();

async function main() {
  const books = await readVault(VAULT);
  const bySlug = new Map(books.map((b) => [b.slug, b]));
  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${books.length}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY (will rewrite files)" : "dry-run"}\n\n`);

  let touched = 0;
  let totalAdded = 0;
  for (const book of books) {
    if (book.seeAlso.length >= MAX_SEE_ALSO) continue;
    if (book.tags.length < MIN_SHARED) continue;

    const tagSet = new Set(book.tags);
    const candidates = [];
    for (const other of books) {
      if (other.slug === book.slug) continue;
      if (book.seeAlso.includes(other.slug)) continue;
      if (other.tags.length < MIN_SHARED) continue;
      let inter = 0;
      for (const t of tagSet) if (other.tagSet.has(t)) inter++;
      if (inter < MIN_SHARED) continue;
      const union = tagSet.size + other.tags.length - inter;
      const jaccard = inter / union;
      if (jaccard < MIN_JACCARD) continue;
      candidates.push({ slug: other.slug, jaccard, inter });
    }

    if (candidates.length === 0) continue;

    candidates.sort((a, b) => b.jaccard - a.jaccard || b.inter - a.inter);
    const merged = [...book.seeAlso];
    const have = new Set(book.seeAlso);
    const seriesCount = new Map();
    const authorCount = new Map();
    // Seed diversity counters with whatever's already in see_also so
    // we don't blow past caps the user has already hand-set. For
    // multi-series books each membership counts separately.
    for (const slug of book.seeAlso) {
      const existing = bySlug.get(slug);
      if (!existing) continue;
      for (const m of parseSeriesMemberships(existing.series)) {
        seriesCount.set(m.name, (seriesCount.get(m.name) ?? 0) + 1);
      }
      const ak = existing.authors[0];
      if (ak) authorCount.set(ak, (authorCount.get(ak) ?? 0) + 1);
    }
    for (const c of candidates) {
      if (merged.length >= MAX_SEE_ALSO) break;
      if (have.has(c.slug)) continue;
      const cand = bySlug.get(c.slug);
      const candMemberships = cand ? parseSeriesMemberships(cand.series) : [];
      const ak = cand?.authors[0];
      if (candMemberships.some((m) => (seriesCount.get(m.name) ?? 0) >= MAX_PER_SERIES)) continue;
      if (ak && (authorCount.get(ak) ?? 0) >= MAX_PER_AUTHOR) continue;
      merged.push(c.slug);
      have.add(c.slug);
      for (const m of candMemberships) {
        seriesCount.set(m.name, (seriesCount.get(m.name) ?? 0) + 1);
      }
      if (ak) authorCount.set(ak, (authorCount.get(ak) ?? 0) + 1);
    }

    const newAdds = merged.length - book.seeAlso.length;
    if (newAdds === 0) continue;

    touched++;
    totalAdded += newAdds;
    process.stdout.write(
      `${book.slug.padEnd(50)} +${newAdds}: ${merged.slice(book.seeAlso.length).join(", ")}\n`,
    );

    if (APPLY) {
      await writeUpdatedSeeAlso(book.path, merged);
    }
  }

  process.stderr.write(`\n${touched} books would gain see_also entries (${totalAdded} total)\n`);
  if (!APPLY) process.stderr.write("(dry-run; rerun with --apply to write)\n");
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
    const tags = Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [];
    out.push({
      slug,
      path: refPath,
      tags,
      tagSet: new Set(tags),
      authors: Array.isArray(data.authors) ? data.authors.filter((a) => typeof a === "string") : [],
      series: typeof data.series === "string" ? data.series : null,
      seeAlso: Array.isArray(data.see_also)
        ? data.see_also.filter((s) => typeof s === "string")
        : [],
    });
  }
  return out;
}

// Mirrors src/lib/books.ts:parseSeriesMemberships — handles the
// `; `-delimited multi-series form ("Discworld, #32; Tiffany Aching #2")
// so multi-series books are diversity-counted under every series they
// belong to, not just the first.
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

async function writeUpdatedSeeAlso(filePath, slugs) {
  const raw = await fs.readFile(filePath, "utf8");
  const newLine = `see_also: [${slugs.map(quoteIfNeeded).join(", ")}]`;
  const seeAlsoRe = /^see_also:.*$/m;
  let updated;
  if (seeAlsoRe.test(raw)) {
    updated = raw.replace(seeAlsoRe, newLine);
  } else {
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
