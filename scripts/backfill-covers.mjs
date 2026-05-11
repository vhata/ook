#!/usr/bin/env node
// Backfills the `cover:` frontmatter URL on every vault book that
// doesn't already have one populated. Two sources, in priority order:
//
//   1. Hardcover cache (`_meta/hardcover-books.json`, populated by
//      `scripts/backfill-hardcover-books.mjs`). The cache now stores an
//      `image_url` per record; this script reads the matching slug's
//      entry and writes the URL straight into the book's frontmatter.
//      Pure cache-to-frontmatter, no network — mirrors the shape of
//      `backfill-hardcover-ids.mjs`.
//
//   2. Open Library covers API as a fallback for books whose `cover:`
//      is empty AND whose Hardcover cache entry has no `image_url`. The
//      script queries by `isbn13` first, then `isbn`, then title+author
//      via the search API. Accepts the first non-placeholder URL.
//      Rate-limited (≥ 100ms between requests) — the API is gentle but
//      shared.
//
// Per-field skip: an existing populated `cover:` value is never
// overwritten. The vault's convention for "no cover" is `cover: null`
// (the YAML-null), with `cover:` (no value) and `cover: ""` as
// equivalents the parser also accepts; all three count as empty for
// the purpose of writing. Any other value — a real URL or even a
// non-null placeholder string the user typed deliberately — is treated
// as populated and left alone, even if Hardcover/Open Library disagree.
// Manual `bin/book cover <slug> <url>` overrides therefore survive
// re-runs.
//
// Default dry-run; --apply rewrites the frontmatter. When stdin is a
// TTY and there are pending changes, the script prompts at the end of
// the dry-run summary; non-TTY stdin (CI, pipes) never prompts.
//
// Dry-run output is shaped as a unified diff — `→ <slug>` per book,
// then a red `- cover: null` / green `+ cover: <url>` pair (or the
// equivalent insertion when the line is absent entirely). ANSI colour
// only when stdout is a TTY; piped output stays plain.
//
// Usage:
//   node scripts/backfill-covers.mjs [--vault PATH] [--apply]
//                                    [--slug SLUG] [--rate-ms MS]
//                                    [--no-open-library] [--debug]
//
//   --apply           write the cover lines (default: dry-run)
//   --slug SLUG       only process one book; useful for spot-checks
//   --rate-ms MS      Open Library request spacing (default 150ms)
//   --no-open-library skip the fallback path; Hardcover-only
//   --debug           print every Open Library URL probed

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { formatBookHeader, formatLineChange, formatLineInsertion } from "./lib/diff-format.mjs";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const SLUG_FILTER = argv.slug ?? null;
const RATE_MS = Math.max(100, Number(argv["rate-ms"] ?? 150));
const SKIP_OPEN_LIBRARY = !!argv["no-open-library"];
const DEBUG = !!argv.debug;
const CACHE_FILE = path.join(VAULT, "_meta", "hardcover-books.json");

const OPEN_LIBRARY_COVERS = "https://covers.openlibrary.org/b";
const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";

// Only run when invoked as a script. When imported as a module for unit
// tests of the pure helpers, skip the auto-run.
const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await main();
}

async function main() {
  const cache = await readCache(CACHE_FILE);
  // Hardcover cache is optional — Open Library fallback still works
  // without it. Warn but don't bail.
  if (!cache) {
    process.stderr.write(
      `note: no Hardcover cache at ${CACHE_FILE} — Open Library fallback only.\n` +
        `(run \`make vault-hardcover-books\` first to populate the cache.)\n`,
    );
  }

  const dirents = await fs.readdir(VAULT, { withFileTypes: true });
  let slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);
  if (SLUG_FILTER) slugs = slugs.filter((s) => s === SLUG_FILTER);

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${slugs.length}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const counts = {
    fromHardcover: 0,
    fromOpenLibrary: 0,
    alreadySet: 0,
    noSource: 0,
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

    if (isCoverPopulated(data.cover)) {
      counts.alreadySet++;
      continue;
    }

    // Try Hardcover cache first — pure data, no network.
    const fromCache = cache ? coverFromCache(cache, slug) : null;
    if (fromCache) {
      counts.fromHardcover++;
      printDiff(slug, raw, fromCache);
      pending.push(() => writeCover(refPath, fromCache));
      continue;
    }

    // Fall back to Open Library when allowed.
    if (SKIP_OPEN_LIBRARY) {
      counts.noSource++;
      continue;
    }

    const fromOl = await coverFromOpenLibrary(data, { debug: DEBUG });
    if (fromOl) {
      counts.fromOpenLibrary++;
      printDiff(slug, raw, fromOl);
      pending.push(() => writeCover(refPath, fromOl));
      // Rate-limit ONLY on the path that actually hit the network.
      await sleep(RATE_MS);
    } else {
      counts.noSource++;
      // Even a no-match touched the network (search + cover-id probes);
      // still respect the rate-limit before the next book.
      if (didProbeOpenLibrary(data)) await sleep(RATE_MS);
    }
  }

  process.stderr.write(
    `\nhardcover: ${counts.fromHardcover} · open-library: ${counts.fromOpenLibrary} · ` +
      `already-set: ${counts.alreadySet} · no source: ${counts.noSource}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "cover updates",
    doApply: async () => {
      for (const write of pending) await write();
      process.stderr.write(`wrote ${pending.length} books\n`);
    },
  });
}

// True when the frontmatter's `cover:` carries a real value. The vault
// uses `cover: null` (YAML null) as the empty form; gray-matter parses
// that as JS `null`. `cover:` with no value parses as `null` too;
// `cover: ""` parses as an empty string. All three count as empty.
// Anything else — a URL, a non-empty placeholder, even whitespace — is
// treated as populated and protected from overwrite.
export function isCoverPopulated(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  // Defensive: a non-string non-null value (e.g. a YAML object) shouldn't
  // ever land in a `cover:` line, but if it does, treat it as populated.
  return true;
}

export function coverFromCache(cache, slug) {
  const record = cache[slug];
  if (!record) return null;
  const url = record.image_url;
  if (typeof url !== "string" || url.length === 0) return null;
  return url;
}

// Open Library cover lookup. Tries ISBN13, then ISBN10 (frontmatter
// stores either under `isbn13` / `isbn`), then a title+author search.
// Returns the first non-placeholder URL it finds, or null.
//
// The covers API supports `https://covers.openlibrary.org/b/isbn/<isbn>-L.jpg`
// directly — a 200 with bytes means a cover exists, a 404 (or a tiny
// placeholder) means it doesn't. Probing the URL with HEAD avoids
// downloading the image; the server returns Content-Length so we can
// distinguish the ~1KB "no cover" placeholder from a real image.
export async function coverFromOpenLibrary(frontmatter, { debug = false, fetchImpl = fetch } = {}) {
  const isbns = collectIsbns(frontmatter);
  for (const isbn of isbns) {
    const url = `${OPEN_LIBRARY_COVERS}/isbn/${encodeURIComponent(isbn)}-L.jpg`;
    if (debug) process.stderr.write(`  probe: ${url}\n`);
    const ok = await isCoverReal(url, fetchImpl);
    if (ok) return url;
  }
  // Fall back to title+author search. Open Library's `cover_i` from the
  // search results is the canonical cover-id; if present, build a
  // direct URL from it.
  const title = stringField(frontmatter.title);
  const author = firstAuthor(frontmatter.authors);
  if (!title) return null;
  const coverId = await searchOpenLibraryCoverId(title, author, fetchImpl, debug);
  if (coverId !== null) return `${OPEN_LIBRARY_COVERS}/id/${coverId}-L.jpg`;
  return null;
}

function collectIsbns(fm) {
  const out = [];
  const isbn13 = stringField(fm.isbn13);
  if (isbn13) out.push(isbn13);
  const isbn = stringField(fm.isbn);
  if (isbn && isbn !== isbn13) out.push(isbn);
  return out;
}

function stringField(value) {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function firstAuthor(authors) {
  if (Array.isArray(authors) && authors.length > 0) return stringField(authors[0]);
  return stringField(authors);
}

// True when the frontmatter has any signal we'd probe Open Library with
// — so the caller can decide whether to apply the rate-limit even on a
// no-match.
function didProbeOpenLibrary(fm) {
  return Boolean(stringField(fm.isbn13) || stringField(fm.isbn) || stringField(fm.title));
}

// HEAD-probe a covers URL. Open Library returns a tiny ~807-byte
// placeholder for "no cover" rather than a 404; the Content-Length
// distinguishes the placeholder from a real image. The convention we
// use here matches Open Library's own documentation hint that real
// covers come back at S/M/L sizes and the placeholder is ~1KB.
async function isCoverReal(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { method: "HEAD", redirect: "follow" });
    if (!res.ok) return false;
    const len = Number(res.headers.get("content-length") ?? 0);
    // Real Open Library covers are ≥ 5KB even at S; the "no cover"
    // placeholder served by the API is well under 2KB. 3KB is the
    // safe gate.
    return len >= 3000;
  } catch {
    return false;
  }
}

async function searchOpenLibraryCoverId(title, author, fetchImpl, debug) {
  const params = new URLSearchParams({ title, limit: "5" });
  if (author) params.set("author", author);
  const url = `${OPEN_LIBRARY_SEARCH}?${params.toString()}`;
  if (debug) process.stderr.write(`  search: ${url}\n`);
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const json = await res.json();
    const docs = Array.isArray(json?.docs) ? json.docs : [];
    for (const doc of docs) {
      const id = doc?.cover_i;
      if (typeof id === "number" && Number.isFinite(id) && id > 0) {
        return id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function printDiff(slug, raw, newUrl) {
  process.stdout.write(`${formatBookHeader(slug)}\n`);
  const existing = raw.match(/^cover:.*$/m);
  if (existing) {
    process.stdout.write(`${formatLineChange(existing[0], `cover: ${newUrl}`)}\n`);
  } else {
    process.stdout.write(`${formatLineInsertion(`cover: ${newUrl}`)}\n`);
  }
}

// Surgical line-level rewrite of the `cover:` field. Mirrors the shape
// of `backfill-source.mjs#writeUpdatedSource`: replace the existing
// line in place, or insert before the closing `---`. We do NOT
// round-trip through gray-matter stringify; that re-serialises the
// whole block and clobbers unrelated whitespace and quote-style.
//
// Exported so unit tests can pin the line-level behaviour without
// spawning the script.
export async function writeCover(filePath, url) {
  const raw = await fs.readFile(filePath, "utf8");
  const updated = applyCoverWrite(raw, url);
  await fs.writeFile(filePath, updated, "utf8");
}

export function applyCoverWrite(raw, url) {
  const newLine = `cover: ${url}`;
  const coverRe = /^cover:.*$/m;
  if (coverRe.test(raw)) {
    return raw.replace(coverRe, newLine);
  }
  // Insert before the closing `---` of the frontmatter block. The `g`
  // flag is critical — without it `replace` would fire on the opener
  // and stop before reaching the closer.
  const close = /^---\s*$/gm;
  let count = 0;
  return raw.replace(close, () => {
    count++;
    return count === 2 ? `${newLine}\n---` : "---";
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply" || a === "--debug" || a === "--no-open-library") {
      out[a.slice(2)] = true;
    } else if (a.startsWith("--")) {
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
