#!/usr/bin/env node
// Backfills `started:` frontmatter on vault books where:
//   1. The book carries an `amazon_asin:` (was matched by the
//      backfill-asin-from-sessions sweep), and
//   2. The kindle-sessions cache has a `firstStart` for that ASIN, and
//   3. The book does NOT already have a `started:` value.
//
// Why: Goodreads-imported books almost always come with a `finished:`
// but no `started:` — the Goodreads CSV doesn't carry start dates.
// The Amazon takeout's first reading-session timestamp for an ASIN is
// a real, evidence-based start date. Stamping it lets the
// reading-streak and "days reading" calculations finally light up
// for the bulk of the corpus's older books.
//
// Pure cache-to-frontmatter: no network. Per-book skip: never
// overwrites an existing `started:`. Manual edits stick.
//
// Time-zone discipline: `firstStart` in the cache is a UTC ISO
// timestamp (e.g. `2024-01-01T02:30:00Z`). Slicing the first ten
// characters off that string gives the UTC date, which can be a day
// off from the reader's lived experience (a session at 02:30Z is
// 21:30 the previous evening on the US East Coast). The vault's
// other date fields are stamped in the operator's local time
// (see `scripts/lib/dates.mjs`'s `todayLocal`), so this script does
// the same: parse the ISO instant, then format it with the runtime's
// local-time calendar fields.
//
// Sanity guard: if the cache's firstStart is AFTER the book's
// `finished:`, skip with a warning — the data is contradictory and
// the operator should look at it by hand rather than have the script
// pick.
//
// Default dry-run. `--apply` rewrites frontmatter; `maybePromptApply`
// gates writes interactively when stdin is a TTY.
//
// Usage:
//   node scripts/backfill-started-from-sessions.mjs [--vault PATH] [--apply]
//                                                    [--slug SLUG]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { formatBookHeader, formatLineInsertion } from "./lib/diff-format.mjs";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";
import { todayLocal } from "./lib/dates.mjs";

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
        `run \`make vault-import-kindle-sessions\` (and apply when prompted) first.\n`,
    );
    process.exit(2);
  }

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
  process.stderr.write(`mode: ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const counts = {
    written: 0,
    alreadySet: 0,
    noAsin: 0,
    noCache: 0,
    contradictory: 0,
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

    if (hasRealStarted(data.started)) {
      counts.alreadySet++;
      continue;
    }
    const asin = typeof data.amazon_asin === "string" ? data.amazon_asin : null;
    if (!asin) {
      counts.noAsin++;
      continue;
    }
    const record = cache[asin];
    if (!record || typeof record.firstStart !== "string") {
      counts.noCache++;
      continue;
    }

    const startedDate = localDateFromIso(record.firstStart);
    if (!startedDate) {
      counts.noCache++;
      continue;
    }
    const finished = typeof data.finished === "string" ? data.finished : null;
    if (finished && startedDate > finished) {
      process.stderr.write(
        `! ${slug}: first session ${startedDate} is AFTER finished ${finished} — skipping (operator review)\n`,
      );
      counts.contradictory++;
      continue;
    }

    counts.written++;
    process.stdout.write(`${formatBookHeader(slug)}\n`);
    process.stdout.write(`${formatLineInsertion(`started: ${startedDate}`)}\n`);
    pending.push(() => writeStarted(refPath, startedDate));
  }

  process.stderr.write(
    `\nwritten: ${counts.written} · already-set: ${counts.alreadySet} · ` +
      `no asin: ${counts.noAsin} · no cache: ${counts.noCache} · ` +
      `contradictory: ${counts.contradictory}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "started frontmatter updates",
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

async function writeStarted(filePath, started) {
  let raw = await fs.readFile(filePath, "utf8");
  raw = insertField(raw, started);
  await fs.writeFile(filePath, raw, "utf8");
}

// Detects whether `data.started` from gray-matter carries a real
// value (a YYYY-MM-DD string, or a Date that round-trips to one).
// Null, undefined, and empty string all count as "no value" — the
// vault's schema uses a literal `started: null` as the placeholder
// shape, and we want to fill those in.
export function hasRealStarted(value) {
  if (typeof value === "string") return value.length > 0;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return false;
}

// Convert a UTC ISO timestamp (the shape `firstStart` takes in the
// kindle-sessions cache) to a YYYY-MM-DD string in the runtime's
// local time zone. Mirrors `lib/dates.mjs`'s `todayLocal` shape so
// the dates this script stamps match every other vault-side date.
// Returns null for any input that doesn't parse into a real instant —
// caller treats a null exactly like a missing cache record.
export function localDateFromIso(iso) {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return todayLocal(d);
}

// Surgical line-level edit, same shape as backfill-pages.mjs /
// backfill-asin-from-sessions.mjs. Avoids round-tripping through
// gray-matter stringify which clobbers whitespace and quote-style.
//
// Two paths:
//   1. The frontmatter has a placeholder `started: null` (or empty
//      string) — replace that line in place, preserving position in
//      the document.
//   2. No `started:` line at all — insert next to a sensible anchor
//      so the new line lands where the rest of the corpus places it.
//
// In both cases, an existing real date value blocks the write —
// caller has already filtered those, this is belt-and-braces.
export function insertField(raw, started) {
  const newLine = `started: ${started}`;

  // Case 0: existing line with a real date value — never overwrite.
  // Match any non-null, non-empty value after `started:`.
  if (/^started:\s+(?!null\s*$)(?!""\s*$)(?!''\s*$)(\S+)/m.test(raw)) {
    return raw;
  }

  // Case 1: existing placeholder line (null / "" / ''), replace it.
  const placeholderRe = /^started:\s*(?:null|""|'')\s*$/m;
  if (placeholderRe.test(raw)) {
    return raw.replace(placeholderRe, newLine);
  }

  // Case 2: no `started:` line — insert next to an anchor.
  const anchors = ["progress", "status", "tags", "bingo_squares"];
  for (const anchor of anchors) {
    const anchorRe = new RegExp(`^(${escapeRe(anchor)}:.*)$`, "m");
    if (anchorRe.test(raw)) {
      return raw.replace(anchorRe, `$1\n${newLine}`);
    }
  }

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
