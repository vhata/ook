#!/usr/bin/env node
// Backfills `finished:` frontmatter on vault books where:
//   1. The book carries an `amazon_asin:` (was matched by the
//      backfill-asin-from-sessions sweep), and
//   2. The kindle-sessions cache has a `lastEnd` for that ASIN, and
//   3. The book does NOT already have a `finished:` value, and
//   4. The book DOES already have a `started:` value, and
//   5. The derived finished date passes the strict guard below.
//
// Why: Goodreads-imported books often come with neither a `started:`
// nor a `finished:` date. The companion backfill-started-from-sessions
// script stamps `started:` from the first reading-session timestamp;
// this one stamps `finished:` from the LAST session's end timestamp.
// Together they let the reading-streak and "days reading" calculations
// light up for the bulk of the corpus's older books.
//
// STRICTER guard than the started-backfill — this is the whole point of
// the script existing separately. The started-backfill trusts the first
// session as the start. The last session is a weaker signal for the
// finish: a long-finished book re-opened for one stray session years
// later (Soul Music / The Last Wish) has a `lastEnd` pointing at the
// re-open, not at when the read actually finished. So instead of the
// started-backfill's loose "lastEnd - firstStart < 60 days" window, this
// script requires:
//   - the book already has a `started:` date (the anchor for when the
//     read actually happened), and
//   - `lastEnd` resolves to within `--guard-days` (default 90) of that
//     `started:` date, and
//   - the derived finished date is not BEFORE `started:`.
// Books that fail the guard are listed as "skipped (guard: …)" and left
// untouched for the operator to fill in by hand. The guard logic and the
// date derivation live in `scripts/lib/finished-from-sessions.mjs`.
//
// Pure cache-to-frontmatter: no network. Per-book skip: never overwrites
// an existing `finished:`. Manual edits stick.
//
// Time-zone discipline: `lastEnd` in the cache is a UTC ISO timestamp.
// `isoToLocalDate` (via the helper) formats it with the runtime's local
// calendar fields, matching every other vault-side date (see
// `scripts/lib/dates.mjs`'s `todayLocal`).
//
// Default dry-run. `--apply` rewrites frontmatter; `maybePromptApply`
// gates writes interactively when stdin is a TTY.
//
// Usage:
//   node scripts/backfill-finished-from-sessions.mjs [--vault PATH] [--apply]
//                                                     [--slug SLUG]
//                                                     [--guard-days N]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { formatBookHeader, formatLineInsertion } from "./lib/diff-format.mjs";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";
import { DEFAULT_GUARD_DAYS, decideFinished } from "./lib/finished-from-sessions.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const SLUG_FILTER = argv.slug ?? null;
const GUARD_DAYS = Number.isFinite(Number(argv["guard-days"]))
  ? Number(argv["guard-days"])
  : DEFAULT_GUARD_DAYS;
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
  process.stderr.write(`guard: lastEnd within ${GUARD_DAYS} days of started:\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const counts = {
    written: 0,
    alreadySet: 0,
    noStarted: 0,
    noAsin: 0,
    noCache: 0,
    guarded: 0,
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

    const asin = typeof data.amazon_asin === "string" ? data.amazon_asin : null;
    if (!asin) {
      counts.noAsin++;
      continue;
    }

    const decision = decideFinished({
      finished: data.finished,
      started: data.started,
      record: cache[asin],
      guardDays: GUARD_DAYS,
    });

    if (decision.action === "skip") {
      if (decision.reason === "already-set") counts.alreadySet++;
      else if (decision.reason === "no-started") counts.noStarted++;
      else counts.noCache++;
      continue;
    }

    if (decision.action === "guard") {
      counts.guarded++;
      const detail =
        decision.reason === "before-started"
          ? `last session ${decision.finished} is BEFORE started ${decision.started}`
          : `last session ${decision.finished} is ${decision.gapDays}d after started ${decision.started} (> ${GUARD_DAYS}d guard)`;
      process.stderr.write(`! ${slug}: skipped (guard: ${detail})\n`);
      continue;
    }

    counts.written++;
    process.stdout.write(`${formatBookHeader(slug)}\n`);
    process.stdout.write(`${formatLineInsertion(`finished: ${decision.finished}`)}\n`);
    pending.push(() => writeFinished(refPath, decision.finished));
  }

  process.stderr.write(
    `\nwritten: ${counts.written} · already-set: ${counts.alreadySet} · ` +
      `no started: ${counts.noStarted} · guarded: ${counts.guarded} · ` +
      `no asin: ${counts.noAsin} · no cache: ${counts.noCache}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "finished frontmatter updates",
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

async function writeFinished(filePath, finished) {
  let raw = await fs.readFile(filePath, "utf8");
  raw = insertField(raw, finished);
  await fs.writeFile(filePath, raw, "utf8");
}

// Surgical line-level edit, same shape as backfill-started-from-sessions.mjs.
// Avoids round-tripping through gray-matter stringify which clobbers
// whitespace and quote-style of unrelated fields.
//
// Two paths:
//   1. The frontmatter has a placeholder `finished: null` (or empty
//      string) — replace that line in place, preserving position.
//   2. No `finished:` line at all — insert next to a sensible anchor
//      (after `started:` first, so the date pair sits together) so the
//      new line lands where the rest of the corpus places it.
//
// In both cases an existing real date value blocks the write — caller
// has already filtered those, this is belt-and-braces.
export function insertField(raw, finished) {
  const newLine = `finished: ${finished}`;

  // Case 0: existing line with a real date value — never overwrite.
  if (/^finished:\s+(?!null\s*$)(?!""\s*$)(?!''\s*$)(\S+)/m.test(raw)) {
    return raw;
  }

  // Case 1: existing placeholder line (null / "" / ''), replace it.
  const placeholderRe = /^finished:\s*(?:null|""|'')\s*$/m;
  if (placeholderRe.test(raw)) {
    return raw.replace(placeholderRe, newLine);
  }

  // Case 2: no `finished:` line — insert next to an anchor. `started:`
  // first so started/finished render adjacent.
  const anchors = ["started", "progress", "status", "tags", "bingo_squares"];
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
