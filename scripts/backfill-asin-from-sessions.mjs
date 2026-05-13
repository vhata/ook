#!/usr/bin/env node
// Backfills `amazon_asin:` frontmatter on every vault book where the
// `_meta/kindle-sessions.json` cache carries a session record whose
// Kindle title normalises to the vault title.
//
// Why: with `amazon_asin` on a book, the per-book renderer can show
// "read across N sessions over D days · ~Xh total" from the sessions
// cache. Without it, sessions in the cache have nothing on the vault
// side to attach to.
//
// Pure cache-to-frontmatter: no network. Re-running on a book that
// already has `amazon_asin:` set is a no-op. Manual edits stick. When
// the cache shows multiple ASINs whose Kindle titles normalise to the
// same vault title (the reader owns more than one edition), the ASIN
// with the higher session count wins — that's the edition actually
// read.
//
// Default dry-run. `--apply` rewrites frontmatter; `maybePromptApply`
// gates writes interactively when stdin is a TTY.
//
// Usage:
//   node scripts/backfill-asin-from-sessions.mjs [--vault PATH] [--apply]
//                                                 [--slug SLUG]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { formatBookHeader, formatLineInsertion } from "./lib/diff-format.mjs";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";
import { buildKindleIndex, matchVaultTitle } from "./lib/asin-match.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const SLUG_FILTER = argv.slug ?? null;
const CACHE_FILE = path.join(VAULT, "_meta", "kindle-sessions.json");

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
      `no kindle-sessions cache at ${CACHE_FILE}\n` +
        `run \`make vault-import-kindle-sessions\` (and apply when prompted) first to populate it.\n`,
    );
    process.exit(2);
  }

  const index = buildKindleIndex(cache);

  const dirents = await fs.readdir(VAULT, { withFileTypes: true });
  let slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name)
    .sort();
  if (SLUG_FILTER) slugs = slugs.filter((s) => s === SLUG_FILTER);

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${slugs.length}\n`);
  process.stderr.write(
    `kindle index: ${index.size} normalised keys across ${countOwnedAsins(cache)} owned ASINs\n`,
  );
  process.stderr.write(`mode: ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const counts = {
    written: 0,
    alreadySet: 0,
    noMatch: 0,
    noRefFile: 0,
  };
  const claimedAsins = new Map();
  const pending = [];

  for (const slug of slugs) {
    const refPath = path.join(VAULT, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refPath, "utf8");
    } catch {
      counts.noRefFile++;
      continue;
    }
    const { data } = matter(raw);

    if (typeof data.amazon_asin === "string" && data.amazon_asin.length > 0) {
      counts.alreadySet++;
      continue;
    }

    const title = typeof data.title === "string" && data.title.length > 0 ? data.title : slug;
    const match = matchVaultTitle(title, index);
    if (!match) {
      counts.noMatch++;
      continue;
    }

    // If two vault slugs hit the same ASIN (unlikely but possible with
    // re-issued titles), the first slug claims it; flag the collision so
    // the operator can decide which one's correct.
    const priorClaim = claimedAsins.get(match.asin);
    if (priorClaim) {
      process.stderr.write(
        `! ${slug}: would claim ${match.asin} but ${priorClaim} already has it — skipping\n`,
      );
      continue;
    }
    claimedAsins.set(match.asin, slug);

    counts.written++;

    process.stdout.write(`${formatBookHeader(slug)}\n`);
    process.stdout.write(`${formatLineInsertion(`amazon_asin: ${match.asin}`)}\n`);
    process.stdout.write(
      `  (${match.sessions} session${match.sessions === 1 ? "" : "s"} · matched "${cache[match.asin].title}")\n`,
    );
    pending.push(() => writeAsin(refPath, match.asin));
  }

  process.stderr.write(
    `\nwritten: ${counts.written} · already-set: ${counts.alreadySet} · ` +
      `no match: ${counts.noMatch} · no ref-file: ${counts.noRefFile}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "amazon_asin frontmatter updates",
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
    return json?.books ?? null;
  } catch {
    return null;
  }
}

function countOwnedAsins(cache) {
  let n = 0;
  for (const record of Object.values(cache)) {
    if (record.title !== null) n++;
  }
  return n;
}

async function writeAsin(filePath, asin) {
  let raw = await fs.readFile(filePath, "utf8");
  raw = insertField(raw, asin);
  await fs.writeFile(filePath, raw, "utf8");
}

// Surgical line-level edit, same shape as backfill-pages.mjs /
// backfill-hardcover-ids.mjs. Avoids round-tripping through gray-matter
// stringify, which clobbers whitespace and quote-style of unrelated
// fields.
export function insertField(raw, asin) {
  const newLine = `amazon_asin: ${asin}`;
  // Caller should have filtered, but never overwrite.
  if (/^amazon_asin:.*$/m.test(raw)) return raw;

  // Insert next to the other external IDs. First anchor that exists wins.
  const anchors = [
    "storygraph_slug",
    "bookwyrm_url",
    "hardcover_slug",
    "hardcover_id",
    "goodreads_id",
    "isbn13",
    "isbn",
  ];
  for (const anchor of anchors) {
    const anchorRe = new RegExp(`^(${escapeRe(anchor)}:.*)$`, "m");
    if (anchorRe.test(raw)) {
      return raw.replace(anchorRe, `$1\n${newLine}`);
    }
  }

  // Fall back to inserting before the closing `---`.
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
