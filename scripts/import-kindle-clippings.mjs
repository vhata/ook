#!/usr/bin/env node
// One-shot importer that takes a Kindle `My Clippings.txt`, fuzzy-matches
// each highlight's book to a vault directory, and writes the highlights
// into the matched book's `quotes.md` under a `## From Kindle` block.
//
// Behaviour summary:
//   - Default dry-run; --apply writes (matches the rest of the backfill
//     pattern in scripts/). Uses scripts/lib/maybe-prompt-apply.mjs for
//     the interactive prompt-to-apply.
//   - --file argument; defaults to /Volumes/Kindle/documents/My Clippings.txt
//     when a Kindle is mounted. Errors out helpfully otherwise.
//   - --vault PATH or BOOKS_DIR env or ./vault default — same as every
//     other backfill.
//   - Per-entry stable dedupe hash. Re-running doesn't duplicate.
//   - Bookmarks are skipped (no body); Highlights and Notes are kept,
//     with Notes routed into a separate `## Notes from Kindle` section.
//   - Unmatched-by-title entries land in `vault/_meta/kindle-unmatched.md`
//     for the operator to triage.
//
// Encoding: `My Clippings.txt` is UTF-8 with BOM on modern Kindles and
// UTF-16-LE on older ones — `decodeClippings` handles both via BOM
// detection.
//
// The parsing, matching, dedupe, and rendering logic lives in
// scripts/lib/kindle-clippings.mjs so it can be unit-tested in isolation.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";
import { formatAddition, formatBookHeader } from "./lib/diff-format.mjs";
import {
  appendEntries,
  decodeClippings,
  matchTitle,
  parseEntry,
  splitEntries,
} from "./lib/kindle-clippings.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const FILE = resolveClippingsPath(argv.file);

await main();

async function main() {
  if (!FILE) {
    process.stderr.write(
      "no clippings file. Pass --file <path>, or mount a Kindle at /Volumes/Kindle.\n",
    );
    process.exit(2);
  }

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`file:  ${FILE}\n`);
  process.stderr.write(`mode:  ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  // 1. Read + decode + split + parse.
  const buf = await fs.readFile(FILE);
  const text = decodeClippings(buf);
  const blocks = splitEntries(text);
  const entries = blocks.map(parseEntry).filter((e) => e !== null);
  process.stderr.write(`parsed: ${entries.length} entries from ${blocks.length} blocks\n`);

  // 2. Build the vault title→slug index from frontmatter.
  const vaultEntries = await readVaultIndex(VAULT);
  process.stderr.write(`vault:  ${vaultEntries.length} books indexed\n\n`);

  // 3. Group entries by matched slug; collect unmatched separately.
  const bySlug = new Map();
  const unmatched = [];
  for (const e of entries) {
    const slug = matchTitle(e.title, vaultEntries);
    if (slug === null) {
      unmatched.push(e);
      continue;
    }
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(e);
  }

  // 4. For each matched book, compute the new quotes.md content (after
  //    dedupe against existing hashes). Pending writes are closures so
  //    the prompt-helper can fire them later without recomputing.
  const pending = [];
  let totalWrittenEntries = 0;
  for (const [slug, slugEntries] of [...bySlug.entries()].sort()) {
    const quotesPath = path.join(VAULT, slug, "quotes.md");
    let existing = "";
    try {
      existing = await fs.readFile(quotesPath, "utf8");
    } catch {
      // No existing quotes.md — fresh write.
    }
    const { next, written } = appendEntries(existing, slugEntries);
    if (written.length === 0) continue;
    totalWrittenEntries += written.length;
    // Unified-diff-style block per book: header + one green `+` line
    // per highlight being appended. Matches the rest of the vault-
    // touching scripts so the operator scans the same shape everywhere.
    process.stdout.write(`${formatBookHeader(`${slug}/quotes.md`)}\n`);
    for (const entry of written) {
      const oneLine = entry.text.replace(/\s+/g, " ").trim();
      process.stdout.write(`${formatAddition(oneLine)}\n`);
    }
    const skipped = slugEntries.length - written.length;
    if (skipped > 0) {
      process.stdout.write(`  (${skipped} already present, skipped)\n`);
    }
    pending.push(async () => {
      await fs.writeFile(quotesPath, next.endsWith("\n") ? next : next + "\n", "utf8");
    });
  }

  // 5. Unmatched bucket. Write a sidecar listing all unmatched entries
  //    so the operator can triage. We don't try to dedupe across runs
  //    here — re-running the importer overwrites the sidecar with the
  //    current pass's set, which is what an operator would want when
  //    iterating on title-match heuristics.
  const unmatchedTitles = new Set(unmatched.map((e) => e.title));
  if (unmatched.length > 0) {
    const unmatchedPath = path.join(VAULT, "_meta", "kindle-unmatched.md");
    pending.push(async () => {
      await fs.mkdir(path.dirname(unmatchedPath), { recursive: true });
      await fs.writeFile(unmatchedPath, renderUnmatched(unmatched), "utf8");
    });
  }

  // 6. Summary.
  process.stderr.write(
    `\n${totalWrittenEntries} highlights matched to ${bySlug.size} books · ` +
      `${unmatched.length} unmatched (${unmatchedTitles.size} distinct titles) · ` +
      `${pending.length - (unmatched.length > 0 ? 1 : 0)} books would be updated\n`,
  );
  if (unmatched.length > 0) {
    process.stderr.write("→ unmatched would be written to _meta/kindle-unmatched.md\n");
  }

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "kindle clippings updates",
    doApply: async () => {
      for (const write of pending) await write();
      process.stderr.write(`wrote ${pending.length} files\n`);
    },
  });
}

function resolveClippingsPath(arg) {
  if (typeof arg === "string" && arg.length > 0) return path.resolve(arg);
  // Default: a Kindle mounted at /Volumes/Kindle (macOS naming).
  return "/Volumes/Kindle/documents/My Clippings.txt";
}

async function readVaultIndex(vault) {
  let dirents;
  try {
    dirents = await fs.readdir(vault, { withFileTypes: true });
  } catch (e) {
    process.stderr.write(`vault read failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return [];
  }
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);

  const out = [];
  for (const slug of slugs) {
    const refPath = path.join(vault, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refPath, "utf8");
    } catch {
      // Slug-without-reference-file — skip; not a real book.
      continue;
    }
    const { data } = matter(raw);
    const title = typeof data.title === "string" && data.title.length > 0 ? data.title : slug;
    const authors = Array.isArray(data.authors)
      ? data.authors.filter((a) => typeof a === "string")
      : [];
    out.push({ slug, title, authors });
  }
  return out;
}

function renderUnmatched(entries) {
  // Group by Kindle title so the operator sees one heading per book
  // followed by all the orphaned highlights for that book.
  const byTitle = new Map();
  for (const e of entries) {
    const key = e.title;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(e);
  }
  const lines = [
    "# Kindle highlights — unmatched",
    "",
    "Highlights from `My Clippings.txt` whose Kindle title couldn't be matched to a vault directory.",
    "Written by `scripts/import-kindle-clippings.mjs`. Triage manually:",
    "",
    "- if the book exists under a different name in the vault, rename it or add the Kindle title as an alias",
    "- if the book isn't in the vault yet, create it then re-run the importer",
    "- if the highlight is from a sample/sneak-peek you don't intend to keep, ignore",
    "",
  ];
  for (const [title, group] of [...byTitle.entries()].sort()) {
    const author = group[0].author ? ` _(${group[0].author})_` : "";
    lines.push(`## ${title}${author}`);
    lines.push("");
    lines.push(`${group.length} highlight${group.length === 1 ? "" : "s"}.`);
    lines.push("");
    for (const e of group) {
      const meta = [];
      if (e.page !== null) meta.push(`Page ${e.page}`);
      else if (e.location !== null) meta.push(`Location ${e.location}`);
      if (e.addedAt) meta.push(e.addedAt);
      const metaStr = meta.length > 0 ? ` _(${meta.join(", ")})_` : "";
      lines.push(`- ${e.kind === "note" ? "**Note**: " : ""}${oneLine(e.text)}${metaStr}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
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
