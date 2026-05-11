#!/usr/bin/env node
// Backfills `pages:` frontmatter on every vault book that doesn't
// already have one, from the Hardcover cache populated by
// `scripts/backfill-hardcover-books.mjs`.
//
// Why: the `/shelf` renderer scales spine width by per-book page count
// via `computeSpineWidth(pages)` (`src/lib/shelf.ts`); without `pages`
// in frontmatter, every spine falls back to the 32 px default and the
// page-count-driven width is a no-op. The Hardcover cache already
// carries a `pages` field per book — this script ferries it into vault
// frontmatter so the shelf width formula kicks in.
//
// Pure cache-to-frontmatter: no network. Re-running on a book that
// already has `pages:` set is a no-op — once the field is in the
// vault, it's user-authoritative and the script won't overwrite it,
// even if the cache disagrees. Manual edits stick.
//
// Default dry-run. `--apply` rewrites the frontmatter; when stdin is a
// TTY and there are pending changes, the script prompts at the end of
// the dry-run summary so the work isn't thrown away. Non-TTY stdin
// (CI, pipes) never prompts.
//
// Usage:
//   node scripts/backfill-pages.mjs [--vault PATH] [--apply]

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

// Only run when invoked as a script. Importing the module from a test
// (for unit tests of the pure helpers) should not kick off a dry-run
// against the real vault.
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

    const havePages =
      typeof data.pages === "number" && Number.isFinite(data.pages) && data.pages > 0;
    if (havePages) {
      counts.alreadySet++;
      continue;
    }

    const record = cache[slug];
    if (!record) {
      counts.noCache++;
      continue;
    }

    const pages =
      typeof record.pages === "number" && Number.isFinite(record.pages) && record.pages > 0
        ? record.pages
        : null;
    if (pages === null) {
      counts.cacheEmpty++;
      continue;
    }

    counts.written++;

    process.stdout.write(`${formatBookHeader(slug)}\n`);
    process.stdout.write(`${formatLineInsertion(`pages: ${pages}`)}\n`);
    pending.push(() => writePages(refPath, pages));
  }

  process.stderr.write(
    `\nwritten: ${counts.written} · already-set: ${counts.alreadySet} · ` +
      `no cache record: ${counts.noCache} · cache has no pages: ${counts.cacheEmpty}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "pages frontmatter updates",
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

// Surgical line-level edit, same shape as backfill-hardcover-ids.mjs.
// Inserts the `pages: <int>` line after the most-relevant existing
// anchor in the frontmatter, falling back to the closing `---`. We do
// NOT round-trip through gray-matter stringify; that re-serialises the
// whole block and clobbers unrelated whitespace and quote-style.
async function writePages(filePath, pages) {
  let raw = await fs.readFile(filePath, "utf8");
  raw = insertField(raw, pages);
  await fs.writeFile(filePath, raw, "utf8");
}

// Exported for unit tests.
export function insertField(raw, pages) {
  const newLine = `pages: ${pages}`;
  // Belt-and-braces — caller should have filtered books that already
  // carry a `pages:` line, but never overwrite if one slipped through.
  if (/^pages:.*$/m.test(raw)) return raw;

  // Anchor priority: insert AFTER one of these existing lines so the
  // new field lands in a sensible neighbourhood (next to the other
  // catalog facts). First match wins.
  const anchors = ["hardcover_id", "hardcover_slug", "goodreads_id", "isbn13", "isbn"];
  for (const anchor of anchors) {
    const anchorRe = new RegExp(`^(${escapeRe(anchor)}:.*)$`, "m");
    if (anchorRe.test(raw)) {
      return raw.replace(anchorRe, `$1\n${newLine}`);
    }
  }

  // Fall back to inserting before the closing `---` of the frontmatter
  // block. The `g` flag is critical — without it `replace` fires on
  // the opener and never reaches the closer.
  const close = /^---\s*$/gm;
  let count = 0;
  return raw.replace(close, () => {
    count++;
    return count === 2 ? `${newLine}\n---` : "---";
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
