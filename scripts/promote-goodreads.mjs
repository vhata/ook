#!/usr/bin/env node
// Promote entries from `_meta/goodreads.md` (the bin/book
// import-goodreads target) into the right vault destination based on
// each entry's `Bookshelves` column.
//
//   - `read` / `currently-reading` → mint a `<Title>/<Title>.md`
//     directory with `status: finished` or `status: reading`. The
//     directory carries the standard Goodreads frontmatter (rating,
//     series, dates, IDs) and surfaces in `/admin/backfill` for the
//     missing-rating / missing-review / would-reread sweeps.
//   - `to-read` → append a bullet to `_meta/tbr.md` under a
//     `## From Goodreads (YYYY-MM-DD)` pile. The user already knows
//     about it; the bullet just needs to land in TBR alongside
//     manually-added rows. De-duped against any existing TBR bullet
//     that mentions the same `goodreads_id` so re-runs are idempotent.
//   - Anything else (custom shelves) → fall through to the vault-
//     directory mint with `status: tbr`, same as before.
//
// Triage minting is gone. `/triage` is for the user's manually-curated
// unknowns; Goodreads entries (a list the user has personally
// curated) don't belong there.
//
// Defaults to **dry-run** because it touches the user's vault. To
// actually write, pass `--apply` (or run interactively and answer
// `y` at the prompt via `maybePromptApply`).
//
// Usage:
//   node scripts/promote-goodreads.mjs --vault ~/path/to/vault [--shelf read] [--max 50] [--apply]
//
// The default vault path is the BOOKS_DIR env var, falling back to
// ./vault (the symlink convention).

import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { cleanTitleAndSeries } from "./lib/promote-goodreads.mjs";
import { routeGoodreadsEntry, renderTbrBullet, appendTbrBullet } from "./lib/goodreads-routing.mjs";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";
import { formatAddition, formatBookHeader } from "./lib/diff-format.mjs";

// Title cleanup: the pure helper lives in `scripts/lib/promote-goodreads.mjs`
// so it can be unit-tested without filesystem IO. Re-export here so any
// caller that historically imported the function from this script still
// gets it.
export { cleanTitleAndSeries };

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

  // Two plan lanes — vault directories minted from `read` /
  // `currently-reading` / fallback shelves, and TBR bullets appended
  // from `to-read`. Both lanes share the skipped-existing / shelf-
  // filter / slug-collision bookkeeping.
  const tbrPath = path.join(VAULT, "_meta", "tbr.md");
  let tbrContent = await readIfExists(tbrPath);
  const tbrSeen = new Set();

  const dirPlans = [];
  const tbrPlans = [];
  let skippedExisting = 0;
  let skippedShelf = 0;
  let skippedSlugCollision = 0;
  let skippedTbrDup = 0;
  const today = todayIso();

  for (const e of entries) {
    if (SHELF_FILTER && e.shelf !== SHELF_FILTER) {
      skippedShelf++;
      continue;
    }

    const route = routeGoodreadsEntry(e.shelf);

    if (route.kind === "tbr-bullet") {
      const gid = e.goodreads_id ?? null;
      if (gid !== null && tbrContent.includes(`goodreads:${gid}`)) {
        skippedTbrDup++;
        continue;
      }
      if (gid !== null && tbrSeen.has(String(gid))) {
        skippedTbrDup++;
        continue;
      }
      const bullet = renderTbrBullet(e);
      tbrPlans.push({ entry: e, bullet, goodreadsId: gid });
      if (gid !== null) tbrSeen.add(String(gid));
      if (dirPlans.length + tbrPlans.length >= MAX) break;
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

    const alreadyPlanned = dirPlans.find((p) => p.slug.toLowerCase() === slug.toLowerCase());
    if (alreadyPlanned) {
      skippedSlugCollision++;
      log(`skip (collision with ${alreadyPlanned.slug}): ${e.title}`);
      continue;
    }

    const fm = buildFrontmatter(e, cleaned, route.status);
    dirPlans.push({ slug, frontmatter: fm, entry: e });
    if (dirPlans.length + tbrPlans.length >= MAX) break;
  }

  log("");
  log(`would mint book dir:    ${dirPlans.length}`);
  log(`would append TBR bullet: ${tbrPlans.length}`);
  log(`skipped (already in vault): ${skippedExisting}`);
  log(`skipped (TBR duplicate):    ${skippedTbrDup}`);
  if (SHELF_FILTER) log(`skipped (shelf filter):     ${skippedShelf}`);
  if (skippedSlugCollision) log(`skipped (slug collisions):  ${skippedSlugCollision}`);

  // Quick shape-of-the-import stats so the user can sanity-check
  // before running with --apply.
  const byShelf = countBy([...dirPlans, ...tbrPlans], (p) => p.entry.shelf);
  const byRating = countBy(
    dirPlans.filter((p) => p.entry.rating && p.entry.rating > 0),
    (p) => `★${p.entry.rating}`,
  );
  const withSeries = dirPlans.filter((p) => p.frontmatter.series).length;
  const withFinished = dirPlans.filter((p) => p.frontmatter.finished).length;
  const withIsbn = dirPlans.filter((p) => p.frontmatter.isbn13 || p.frontmatter.isbn).length;
  log("");
  log(`shape:`);
  log(`  by shelf: ${formatCounts(byShelf)}`);
  if (Object.keys(byRating).length > 0) log(`  rated:    ${formatCounts(byRating)}`);
  log(`  with series field: ${withSeries}`);
  log(`  with finished date: ${withFinished}`);
  log(`  with ISBN: ${withIsbn}`);
  log("");

  if (VERBOSE || !APPLY) {
    for (const p of dirPlans) {
      const shelf = p.entry.shelf;
      const date = formatDateLike(p.entry.date_read) ?? "—";
      const rating = p.entry.rating ? `★${p.entry.rating}` : "  ";
      log(`  mint   ${shelf.padEnd(18)} ${rating} ${date.padEnd(10)} ${p.slug}`);
    }
    for (const p of tbrPlans) {
      log(`  tbr    to-read           ${"  "} ${"—".padEnd(10)} ${p.bullet}`);
    }
    log("");
  }

  // Unified-diff-style dry-run output for the operator's eyeball. Each
  // would-mint book gets a header + green `+` lines for every line of
  // the proposed file. Each would-append TBR bullet gets a header
  // naming `_meta/tbr.md` and a single green `+` line for the bullet.
  // Matches the shape of the backfill scripts' colored output.
  if (!APPLY && (dirPlans.length > 0 || tbrPlans.length > 0)) {
    for (const p of dirPlans) {
      const refPath = `${p.slug}/${p.slug}.md`;
      const content = renderBookFile(p.frontmatter);
      log(formatBookHeader(refPath));
      for (const line of content.split("\n")) {
        log(formatAddition(line));
      }
    }
    if (tbrPlans.length > 0) {
      log(formatBookHeader("_meta/tbr.md"));
      for (const p of tbrPlans) {
        log(formatAddition(p.bullet));
      }
    }
    log("");
  }

  const totalChanges = dirPlans.length + tbrPlans.length;
  await maybePromptApply({
    apply: APPLY,
    changeCount: totalChanges,
    changeNoun: "promotions",
    doApply: async () => {
      let writtenDirs = 0;
      for (const p of dirPlans) {
        const dir = path.join(VAULT, p.slug);
        await fs.mkdir(dir, { recursive: true });
        const refFile = path.join(dir, `${p.slug}.md`);
        const content = renderBookFile(p.frontmatter);
        await fs.writeFile(refFile, content, "utf8");
        writtenDirs++;
      }

      let writtenTbr = 0;
      let nextTbr = tbrContent;
      for (const p of tbrPlans) {
        const next = appendTbrBullet(nextTbr, p.bullet, today, p.goodreadsId);
        if (next.changed) {
          nextTbr = next.content;
          writtenTbr++;
        }
      }
      if (writtenTbr > 0) {
        if (nextTbr.length === 0 || !nextTbr.endsWith("\n")) nextTbr += "\n";
        await fs.writeFile(tbrPath, nextTbr, "utf8");
        tbrContent = nextTbr;
      }

      log(`Wrote ${writtenDirs} new book directories under ${VAULT}.`);
      if (writtenTbr > 0)
        log(`Appended ${writtenTbr} bullets to ${path.relative(VAULT, tbrPath)}.`);
      log("");
      log("Next steps:");
      log("  1. cd into the vault and review the new files.");
      log("  2. Stage / commit / push them per the vault's auto-commit policy.");
      log("  3. Promote individual entries with `bin/book` for richer notes.");
    },
  });
}

// ----- helpers ---------------------------------------------------------------

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return "";
    throw err;
  }
}

function todayIso() {
  // Local-time date, not UTC — operator running this at 8:30 PM PDT
  // should stamp today's date, not tomorrow's.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

// Filesystem-safe slug — keep human-readable (matches the existing
// vault convention of using the title verbatim) but strip characters
// that would break paths or git on case-insensitive FS.
function sanitizeSlug(title) {
  return title
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFrontmatter(entry, cleaned, statusOverride) {
  const status =
    statusOverride ??
    (entry.shelf === "read" ? "finished" : entry.shelf === "currently-reading" ? "reading" : "tbr");

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
