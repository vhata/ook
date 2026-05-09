#!/usr/bin/env node
// Extends `tags` for books with thin or empty tag lists by tallying
// tags across the book's peers — same series, same author, and books
// linked to/from it via `see_also`. Pure derivation from corpus state;
// no network. Companion to `backfill-tags.mjs` (Open Library), run
// after it to pick up books Open Library couldn't tag because the
// curated vocabulary mapping rejected the noisy subjects.
//
// Why a tag inherits, by signal source:
//
//   - Same-series mate carries the tag, AND >= SERIES_FRAC_MIN of the
//     series carries it (default 0.66). Series are roughly
//     genre-uniform, but the bar is set above a bare majority because
//     50% gave too many false positives on small series.
//   - Same-author count >= AUTHOR_COUNT_MIN (default 3) AND >= AUTHOR_FRAC_MIN
//     fraction (default 0.8). Authors are heterogeneous (Pratchett wrote
//     fantasy AND scifi), so a single author-mate's tag is not enough.
//   - See_also count >= SEEALSO_COUNT_MIN (default 3) distinct peers (in
//     either direction). Curated cross-refs disagree more than series
//     mates, so we need three voices to agree.
//
// Existing tags are preserved; new ones append; total capped at
// LIMIT_TAGS (default 5, matching backfill-tags.mjs).
//
// Defaults to **dry-run**. Pass `--apply` to write the vault.
//
// Usage:
//   node scripts/backfill-tags-from-peers.mjs [--vault PATH] [--apply]
//                                             [--limit-tags N]
//                                             [--series-frac F]
//                                             [--author-count N] [--author-frac F]
//                                             [--seealso-count N]

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const LIMIT_TAGS = Number(argv["limit-tags"] ?? 5);
const SERIES_FRAC_MIN = Number(argv["series-frac"] ?? 0.66);
const AUTHOR_COUNT_MIN = Number(argv["author-count"] ?? 3);
const AUTHOR_FRAC_MIN = Number(argv["author-frac"] ?? 0.8);
const SEEALSO_COUNT_MIN = Number(argv["seealso-count"] ?? 3);

await main();

async function main() {
  const books = await readVault(VAULT);
  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${books.length}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY (will rewrite files)" : "dry-run"}\n\n`);

  const bySlug = new Map(books.map((b) => [b.slug, b]));
  const bySeriesName = new Map();
  const byAuthor = new Map();
  const seeAlsoBackrefs = new Map(); // slug → set of slugs that reference it
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
    for (const ref of b.seeAlso) {
      const set = seeAlsoBackrefs.get(ref) ?? new Set();
      set.add(b.slug);
      seeAlsoBackrefs.set(ref, set);
    }
  }

  let touched = 0;
  let totalAdded = 0;
  for (const book of books) {
    if (book.tags.length >= LIMIT_TAGS) continue;

    // Series peers: union across every series this book belongs to,
    // deduped by slug so a multi-series book doesn't double-count.
    const seriesPeerSet = new Map();
    for (const m of parseSeriesMemberships(book.series)) {
      for (const peer of bySeriesName.get(m.name) ?? []) {
        if (peer.slug === book.slug) continue;
        seriesPeerSet.set(peer.slug, peer);
      }
    }
    const seriesPeers = [...seriesPeerSet.values()];
    const authorKey = book.authors[0];
    const authorPeers = (authorKey ? (byAuthor.get(authorKey) ?? []) : [])
      .filter((b) => b.slug !== book.slug)
      .filter((b) => !seriesPeers.some((s) => s.slug === b.slug));
    const seeAlsoPeerSlugs = new Set([
      ...book.seeAlso,
      ...(seeAlsoBackrefs.get(book.slug) ?? new Set()),
    ]);
    seeAlsoPeerSlugs.delete(book.slug);
    const seeAlsoPeers = [...seeAlsoPeerSlugs]
      .map((s) => bySlug.get(s))
      .filter(Boolean)
      .filter((b) => !seriesPeers.some((s) => s.slug === b.slug))
      .filter((b) => !authorPeers.some((s) => s.slug === b.slug));

    if (seriesPeers.length === 0 && authorPeers.length === 0 && seeAlsoPeers.length === 0) continue;

    // Per-tag tallies, kept separate by signal source so we can apply
    // the right threshold to each.
    const tally = new Map(); // tag → {series, author, seeAlso}
    const bumpTag = (tag, source) => {
      const entry = tally.get(tag) ?? { series: 0, author: 0, seeAlso: 0 };
      entry[source]++;
      tally.set(tag, entry);
    };
    for (const p of seriesPeers) for (const t of p.tags) bumpTag(t, "series");
    for (const p of authorPeers) for (const t of p.tags) bumpTag(t, "author");
    for (const p of seeAlsoPeers) for (const t of p.tags) bumpTag(t, "seeAlso");

    const have = new Set(book.tags);
    const candidates = [];
    for (const [tag, counts] of tally) {
      if (have.has(tag)) continue;

      const seriesQualifies =
        seriesPeers.length > 0 &&
        counts.series >= 1 &&
        counts.series / seriesPeers.length >= SERIES_FRAC_MIN;
      const authorQualifies =
        authorPeers.length > 0 &&
        counts.author >= AUTHOR_COUNT_MIN &&
        counts.author / authorPeers.length >= AUTHOR_FRAC_MIN;
      const seeAlsoQualifies = counts.seeAlso >= SEEALSO_COUNT_MIN;

      if (!seriesQualifies && !authorQualifies && !seeAlsoQualifies) continue;

      // Priority: series > author > seeAlso. Score by the strongest
      // qualifying signal so the proposed list orders sensibly.
      const score = seriesQualifies
        ? 1000 + counts.series
        : authorQualifies
          ? 500 + counts.author
          : counts.seeAlso;
      const reason = seriesQualifies
        ? `series ${counts.series}/${seriesPeers.length}`
        : authorQualifies
          ? `author ${counts.author}/${authorPeers.length}`
          : `see_also ${counts.seeAlso}`;
      candidates.push({ tag, score, reason });
    }

    if (candidates.length === 0) continue;

    candidates.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
    const merged = [...book.tags];
    const additions = [];
    for (const c of candidates) {
      if (merged.length >= LIMIT_TAGS) break;
      merged.push(c.tag);
      additions.push(c);
    }
    if (additions.length === 0) continue;

    touched++;
    totalAdded += additions.length;
    const summary = additions.map((a) => `${a.tag} (${a.reason})`).join(", ");
    process.stdout.write(`${book.slug.padEnd(50)} +${additions.length}: ${summary}\n`);

    if (APPLY) {
      await writeUpdatedTags(book.path, merged);
    }
  }

  process.stderr.write(`\n${touched} books would gain tags (${totalAdded} total)\n`);
  if (!APPLY) process.stderr.write("(dry-run; rerun with --apply to write)\n");
}

// Mirrors src/lib/books.ts:parseSeriesMemberships — handles the
// `; `-delimited multi-series form ("Discworld, #32; Tiffany Aching #2")
// so multi-series books contribute to peer tallies for every series
// they belong to.
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
      tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [],
      seeAlso: Array.isArray(data.see_also)
        ? data.see_also.filter((s) => typeof s === "string")
        : [],
    });
  }
  return out;
}

async function writeUpdatedTags(filePath, tags) {
  const raw = await fs.readFile(filePath, "utf8");
  const newLine = `tags: [${tags.join(", ")}]`;
  const tagsRe = /^tags:.*$/m;
  let updated;
  if (tagsRe.test(raw)) {
    updated = raw.replace(tagsRe, newLine);
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
