#!/usr/bin/env node
// Backfills `premise:` frontmatter on every vault book that doesn't
// already have one, from the Hardcover cache populated by
// `scripts/backfill-hardcover-books.mjs`.
//
// Why: `premise` is the tier-0 back-cover-style blurb rendered on every
// per-book page. The user shouldn't have to type it — the cover copy
// for a published book is well-known and non-spoiler by definition.
// Hardcover already ships a `description` field on each book record;
// we cache it during the Hardcover lookup and ferry it into vault
// frontmatter from here.
//
// Pure cache-to-frontmatter: no network. Re-running on a book that
// already has `premise:` set is a no-op — once the field is in the
// vault, it's user-authoritative and the script won't overwrite it,
// even if the cache disagrees. Manual edits stick.
//
// Default dry-run. `--apply` rewrites the frontmatter; when stdin is a
// TTY and there are pending changes, the script prompts at the end of
// the dry-run summary so the work isn't thrown away. Non-TTY stdin
// (CI, pipes) never prompts.
//
// Usage:
//   node scripts/backfill-premises.mjs [--vault PATH] [--apply]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { formatBookHeader, formatLineInsertion } from "./lib/diff-format.mjs";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const CACHE_FILE = path.join(VAULT, "_meta", "hardcover-books.json");

// Only run when invoked as a script (node scripts/...). When imported
// as a module — for unit tests of the pure helpers — skip the auto-run
// so we don't kick off a dry-run against the real vault.
const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await main();
}

async function main() {
  const cache = await readCache(CACHE_FILE);
  if (!cache) {
    process.stderr.write(
      `no Hardcover cache at ${CACHE_FILE}\n` +
        `run \`make vault-hardcover-books\` (and apply when prompted) first to populate it.\n`,
    );
    process.exit(2);
  }

  const dirents = await fs.readdir(VAULT, { withFileTypes: true });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name)
    .sort();

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${slugs.length}\n`);
  process.stderr.write(`cache records: ${Object.keys(cache).length}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const counts = {
    written: 0,
    alreadySet: 0,
    noCache: 0,
    cacheEmpty: 0,
  };
  const pending = [];

  for (const slug of slugs) {
    const refPath = path.join(VAULT, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refPath, "utf8");
    } catch {
      continue;
    }
    const { data } = matter(raw);

    const havePremise = typeof data.premise === "string" && data.premise.trim().length > 0;
    if (havePremise) {
      counts.alreadySet++;
      continue;
    }

    const record = cache[slug];
    if (!record) {
      counts.noCache++;
      continue;
    }

    const description =
      typeof record.description === "string" && record.description.trim().length > 0
        ? record.description
        : null;
    if (description === null) {
      counts.cacheEmpty++;
      continue;
    }

    counts.written++;

    const block = formatPremiseBlock(description);
    process.stdout.write(`${formatBookHeader(slug)}\n`);
    for (const line of block.split("\n")) {
      process.stdout.write(`${formatLineInsertion(line)}\n`);
    }
    pending.push(() => writePremise(refPath, block));
  }

  process.stderr.write(
    `\nwritten: ${counts.written} · already-set: ${counts.alreadySet} · ` +
      `no cache record: ${counts.noCache} · cache has no description: ${counts.cacheEmpty}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "premise frontmatter updates",
    doApply: async () => {
      for (const write of pending) await write();
      process.stderr.write(`wrote ${pending.length} books\n`);
    },
  });
}

async function readCache(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    const json = JSON.parse(raw);
    return json?.records ?? null;
  } catch {
    return null;
  }
}

// Format the premise as a folded block scalar so a long description
// reads cleanly in the frontmatter editor instead of as a single
// runaway line. Whitespace inside the description is normalised
// (collapsed to single spaces) so the wrap is deterministic; the
// final scalar value the YAML parser produces is one paragraph with
// single-spaced words. Exported for unit tests.
export function formatPremiseBlock(description) {
  const normalised = description.replace(/\s+/g, " ").trim();
  const lines = wrapWords(normalised, 70);
  return ["premise: >-", ...lines.map((l) => `  ${l}`)].join("\n");
}

function wrapWords(text, max) {
  const words = text.split(" ");
  const out = [];
  let current = "";
  for (const w of words) {
    if (current.length === 0) {
      current = w;
      continue;
    }
    if (current.length + 1 + w.length <= max) {
      current += " " + w;
      continue;
    }
    out.push(current);
    current = w;
  }
  if (current) out.push(current);
  return out;
}

// Surgical line-level edit, same shape as backfill-hardcover-ids.mjs.
// Inserts the multi-line `premise: >-` block after the most-relevant
// existing anchor in the frontmatter, falling back to the closing
// `---`. We do NOT round-trip through gray-matter stringify.
async function writePremise(filePath, block) {
  let raw = await fs.readFile(filePath, "utf8");
  raw = insertBlock(raw, block);
  await fs.writeFile(filePath, raw, "utf8");
}

// Exported for unit tests.
export function insertBlock(raw, block) {
  // Belt-and-braces — caller should have filtered books that already
  // carry a `premise:` line, but never overwrite if one slipped through.
  if (/^premise:.*$/m.test(raw)) return raw;

  // Anchor priority: insert AFTER one of these existing lines so the
  // premise lands in a sensible neighbourhood (after metadata, before
  // any per-book sections like tags or see_also). First match wins.
  const anchors = ["hardcover_id", "hardcover_slug", "goodreads_id", "isbn13", "isbn", "cover"];
  for (const anchor of anchors) {
    const anchorRe = new RegExp(`^(${escapeRe(anchor)}:.*)$`, "m");
    if (anchorRe.test(raw)) {
      return raw.replace(anchorRe, `$1\n${block}`);
    }
  }

  // Fall back to inserting before the closing `---` of the frontmatter
  // block. The `g` flag is critical — without it `replace` fires on
  // the opener and never reaches the closer.
  const close = /^---\s*$/gm;
  let count = 0;
  return raw.replace(close, () => {
    count++;
    return count === 2 ? `${block}\n---` : "---";
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
