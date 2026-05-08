#!/usr/bin/env node
// Promote entries from `_meta/goodreads.md` (the bin/book
// import-goodreads target) into actual per-book vault directories,
// fleshing out what was previously a flat reference table.
//
// For each Goodreads entry that doesn't already correspond to a
// vault directory, generates `<Title>/<Title>.md` with frontmatter
// derived from the CSV-imported fields:
//
//   - status: read → finished, currently-reading → reading, else tbr
//   - finished: from date_read for read shelf
//   - started:  from date_read - 1d for read shelf, date_added for cr
//   - rating:   nullable (0 in CSV ⇒ null)
//   - series:   extracted from "(Series, #N)" parenthetical in title
//   - authors:  array as in goodreads.md
//   - goodreads_id: preserved
//   - isbn / isbn13: preserved when present
//
// Defaults to **dry-run** because it touches the user's vault. To
// actually write, pass `--apply`. The user is expected to review
// the dry-run output before applying.
//
// Usage:
//   node scripts/promote-goodreads.mjs --vault ~/path/to/vault [--shelf read] [--max 50] [--apply]
//
// The default vault path is the BOOKS_DIR env var, falling back to
// ./vault (the symlink convention).

import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

// ----- constants -------------------------------------------------------------

// Title cleanup: detect a trailing "(Series Name, #N)" or "(Series #N)"
// parenthetical and split it off. Declared up here so the module-level
// `await main()` doesn't hit a temporal-dead-zone error when it
// reaches into helper functions that read this regex.
const SERIES_RE = /^(.+?)\s*\((.+?)\)\s*$/;

// ----- argv ------------------------------------------------------------------

const argv = parseArgs(process.argv.slice(2));
const APPLY = !!argv.apply;
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const SHELF_FILTER = argv.shelf ?? null;
const MAX = argv.max !== undefined ? Number(argv.max) : Infinity;
const VERBOSE = !!argv.verbose;

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--verbose") out.verbose = true;
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

// ----- main ------------------------------------------------------------------

await main();

async function main() {
  log(`vault: ${VAULT}`);
  log(`mode:  ${APPLY ? "APPLY (will write to vault)" : "dry-run (no writes)"}`);
  if (SHELF_FILTER) log(`shelf filter: ${SHELF_FILTER}`);
  if (MAX !== Infinity) log(`max entries: ${MAX}`);
  log("");

  const goodreadsPath = path.join(VAULT, "_meta", "goodreads.md");
  const goodreadsContent = await fs.readFile(goodreadsPath, "utf8");
  const data = parseFrontmatterOnly(goodreadsContent);
  const entries = Array.isArray(data.entries) ? data.entries : [];
  log(`${entries.length} entries in goodreads.md`);

  const existing = await listVaultDirectories(VAULT);
  const existingLower = new Set([...existing].map((s) => s.toLowerCase()));
  log(`${existing.size} existing book directories in vault`);
  log("");

  const plans = [];
  let skippedExisting = 0;
  let skippedShelf = 0;
  let skippedSlugCollision = 0;
  for (const e of entries) {
    if (SHELF_FILTER && e.shelf !== SHELF_FILTER) {
      skippedShelf++;
      continue;
    }

    const cleaned = cleanTitleAndSeries(e.title ?? "");
    const slug = sanitizeSlug(cleaned.title);
    if (!slug) {
      log(`skip (empty slug): ${e.title}`);
      continue;
    }
    if (existingLower.has(slug.toLowerCase())) {
      skippedExisting++;
      continue;
    }

    // Detect within-batch slug collisions (two Goodreads entries that
    // would generate the same dir name).
    const alreadyPlanned = plans.find((p) => p.slug.toLowerCase() === slug.toLowerCase());
    if (alreadyPlanned) {
      skippedSlugCollision++;
      log(`skip (collision with ${alreadyPlanned.slug}): ${e.title}`);
      continue;
    }

    const fm = buildFrontmatter(e, cleaned);
    plans.push({ slug, frontmatter: fm, entry: e });
    if (plans.length >= MAX) break;
  }

  log("");
  log(`would create: ${plans.length}`);
  log(`skipped (already in vault): ${skippedExisting}`);
  if (SHELF_FILTER) log(`skipped (shelf filter): ${skippedShelf}`);
  if (skippedSlugCollision) log(`skipped (slug collisions): ${skippedSlugCollision}`);

  // Quick shape-of-the-import stats so the user can sanity-check
  // before running with --apply.
  const byShelf = countBy(plans, (p) => p.entry.shelf);
  const byRating = countBy(
    plans.filter((p) => p.entry.rating && p.entry.rating > 0),
    (p) => `★${p.entry.rating}`,
  );
  const withSeries = plans.filter((p) => p.frontmatter.series).length;
  const withFinished = plans.filter((p) => p.frontmatter.finished).length;
  const withIsbn = plans.filter((p) => p.frontmatter.isbn13 || p.frontmatter.isbn).length;
  log("");
  log(`shape:`);
  log(`  by shelf: ${formatCounts(byShelf)}`);
  if (Object.keys(byRating).length > 0) log(`  rated:    ${formatCounts(byRating)}`);
  log(`  with series field: ${withSeries}`);
  log(`  with finished date: ${withFinished}`);
  log(`  with ISBN: ${withIsbn}`);
  log("");

  if (VERBOSE || !APPLY) {
    for (const p of plans) {
      const shelf = p.entry.shelf;
      const date = formatDateLike(p.entry.date_read) ?? "—";
      const rating = p.entry.rating ? `★${p.entry.rating}` : "  ";
      log(`  ${shelf.padEnd(18)} ${rating} ${date.padEnd(10)} ${p.slug}`);
    }
    log("");
  }

  if (!APPLY) {
    log("(dry-run; rerun with --apply to write)");
    return;
  }

  log("Writing book directories…");
  let written = 0;
  for (const p of plans) {
    const dir = path.join(VAULT, p.slug);
    await fs.mkdir(dir, { recursive: true });
    const refFile = path.join(dir, `${p.slug}.md`);
    const content = renderBookFile(p.frontmatter);
    await fs.writeFile(refFile, content, "utf8");
    written++;
  }
  log(`Wrote ${written} new book directories under ${VAULT}.`);
  log("");
  log("Next steps:");
  log("  1. cd into the vault and review the new files.");
  log("  2. Stage / commit / push them per the vault's auto-commit policy.");
  log("  3. Promote individual entries with `bin/book` for richer notes.");
}

// ----- helpers ---------------------------------------------------------------

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Parse only the YAML frontmatter portion of a markdown file, between
// the first two `---` delimiters. The body (if any) is ignored.
function parseFrontmatterOnly(content) {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) throw new Error("goodreads.md is missing YAML frontmatter delimiters");
  return yaml.load(m[1]);
}

async function listVaultDirectories(vault) {
  const set = new Set();
  let entries;
  try {
    entries = await fs.readdir(vault, { withFileTypes: true });
  } catch {
    return set;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "_meta" || e.name.startsWith(".") || e.name === "bin") continue;
    set.add(e.name);
  }
  return set;
}

// Title cleanup: detect a trailing "(Series Name, #N)" or "(Series #N)"
// parenthetical and split it off. Also handles "(Series Name)" (no
// number) and "(Series Name, Vol. 2)" loosely. The regex itself lives
// near the top of the file (above `await main()`).

export function cleanTitleAndSeries(rawTitle) {
  // YAML coerces values like "1984" to numbers — re-stringify
  // defensively.
  const title = String(rawTitle ?? "").trim();
  const match = SERIES_RE.exec(title);
  if (!match) return { title, series: null };

  const [, before, inside] = match;
  // Heuristic: only treat the parenthetical as a series suffix if it
  // contains a number (e.g. "#3", "Vol. 2", "Book 1"). Otherwise
  // it's probably part of the title (e.g. "Sapiens (A Brief History)").
  const hasNumber = /[#\d]/.test(inside);
  if (!hasNumber) return { title, series: null };

  // Normalise to "Series Name #N" form when the inside is "Series, #N".
  const seriesNorm = inside
    .replace(/,\s*(#[\d.]+)$/, " $1")
    .replace(/\s+/g, " ")
    .trim();
  return { title: before.trim(), series: seriesNorm };
}

// Filesystem-safe slug — keep human-readable (matches the existing
// vault convention of using the title verbatim) but strip characters
// that would break paths or git on case-insensitive FS.
function sanitizeSlug(title) {
  return title
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFrontmatter(entry, cleaned) {
  const status =
    entry.shelf === "read" ? "finished" : entry.shelf === "currently-reading" ? "reading" : "tbr";

  const rating = entry.rating && entry.rating > 0 ? entry.rating : null;
  const dateRead = formatDateLike(entry.date_read);
  const dateAdded = formatDateLike(entry.date_added);
  const finished = status === "finished" ? dateRead : null;
  // For currently-reading, prefer date_read (rare on cr) then date_added.
  // For finished books we leave `started` null since the CSV doesn't
  // carry a real start date; the user fills it in if it matters.
  const started = status === "reading" ? (dateRead ?? dateAdded) : null;

  const fm = {
    title: cleaned.title,
    authors: Array.isArray(entry.authors) ? entry.authors : [],
    series: cleaned.series,
    status,
    progress: "",
    started,
    finished,
    rating,
    would_reread: null,
    bingo_squares: [],
    tags: [],
    cover: null,
    pullquote: null,
    see_also: [],
    source: "goodreads",
    goodreads_id: entry.goodreads_id ?? null,
  };
  if (entry.isbn13) fm.isbn13 = String(entry.isbn13);
  if (entry.isbn) fm.isbn = String(entry.isbn);
  return fm;
}

// js-yaml parses bare YAML dates (`2026-04-23`) as Date objects, but
// our vault convention is YYYY-MM-DD strings. Coerce both shapes to
// the string form. Returns null for null / undefined / unparseable.
function formatDateLike(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  return null;
}

function renderBookFile(fm) {
  // Hand-roll the YAML so quoting / null / array shape match the
  // existing vault style (see Assassin's Apprentice/Assassin's
  // Apprentice.md for reference).
  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    lines.push(yamlLine(key, value));
  }
  lines.push("---");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("*(Imported from Goodreads — no notes captured yet.)*");
  lines.push("");
  return lines.join("\n");
}

function yamlLine(key, value) {
  if (value === null || value === undefined) return `${key}: null`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    const items = value.map((v) => quoteIfNeeded(v)).join(", ");
    return `${key}: [${items}]`;
  }
  if (typeof value === "boolean" || typeof value === "number") return `${key}: ${value}`;
  if (typeof value === "string") {
    if (value === "") return `${key}: ""`;
    return `${key}: ${quoteIfNeeded(value)}`;
  }
  return `${key}: ${JSON.stringify(value)}`;
}

function countBy(items, key) {
  const out = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function formatCounts(counts) {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k}=${v}`)
    .join("  ");
}

function quoteIfNeeded(value) {
  if (typeof value !== "string") return JSON.stringify(value);
  // Quote when the value contains a YAML-special character or could
  // be misparsed as a non-string (looks like a number, bool, null, etc).
  const needsQuote =
    /[:#@!&*%?>|"'`{}[\],]/.test(value) ||
    /^(?:true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /^[+-]?\d/.test(value) ||
    /^\s|\s$/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
