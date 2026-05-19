#!/usr/bin/env node
// Backfills the `cover:` frontmatter URL on every vault book that
// doesn't already have one populated. Three sources, in priority order:
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
//      via the search API. Editions are ranked by language/region
//      preference (English default; honours `language: <code>` and
//      `region:` / `edition:` frontmatter when present) before the
//      placeholder-size gate decides. When every candidate fails the
//      gate the script keeps the best marginal ISBN13 URL it saw, so a
//      thin-cover ISBN13 result is preferred to nothing — the
//      cover-picker UI can still surface the candidate for review.
//
//   3. Google Books Volumes API as a secondary, last-resort source when
//      Open Library has nothing usable. Queries `q=isbn:<isbn13>` first
//      then `q=intitle:<title>+inauthor:<author>`. No auth, no token —
//      same offline-clean discipline as the rest of the script.
//      `volumeInfo.imageLinks.thumbnail` / `.smallThumbnail` URLs are
//      HEAD-probed the same way as the Open Library candidates.
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
//                                    [--no-open-library] [--no-google-books]
//                                    [--debug]
//
//   --apply           write the cover lines (default: dry-run)
//   --slug SLUG       only process one book; useful for spot-checks
//   --rate-ms MS      external-API request spacing (default 150ms)
//   --no-open-library skip the Open Library fallback; Hardcover-only
//   --no-google-books skip the Google Books secondary fallback
//   --debug           print every external URL probed

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
const SKIP_GOOGLE_BOOKS = !!argv["no-google-books"];
const DEBUG = !!argv.debug;
const CACHE_FILE = path.join(VAULT, "_meta", "hardcover-books.json");

const OPEN_LIBRARY_COVERS = "https://covers.openlibrary.org/b";
const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";
const GOOGLE_BOOKS_VOLUMES = "https://www.googleapis.com/books/v1/volumes";

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
    fromOpenLibraryMarginal: 0,
    fromGoogleBooks: 0,
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

    // External-API fallback path. Open Library first (cheapest, oldest
    // integration); Google Books as a secondary when OL has nothing
    // usable. Either branch may be skipped via the corresponding flag.
    if (SKIP_OPEN_LIBRARY && SKIP_GOOGLE_BOOKS) {
      counts.noSource++;
      continue;
    }

    const preferences = readCoverPreferences(data);
    let chosenUrl = null;
    let chosenSource = null;
    let marginalFloor = null;
    let touchedNetwork = false;

    if (!SKIP_OPEN_LIBRARY) {
      const found = await findOpenLibraryCandidate(data, { debug: DEBUG, preferences });
      touchedNetwork = touchedNetwork || didProbeOpenLibrary(data);
      if (found && !found.marginal) {
        chosenUrl = found.url;
        chosenSource = "open-library";
      } else if (found?.marginal) {
        // Hold the marginal ISBN13 hit as a last-resort floor — only
        // accept it if Google Books also fails. Don't credit the
        // counter yet; we want stats to reflect what actually shipped.
        marginalFloor = found.url;
      }
    }

    if (!chosenUrl && !SKIP_GOOGLE_BOOKS) {
      // Rate-limit between sources too — Google Books is on a separate
      // host but the operator's intent is "be polite to all of them."
      if (touchedNetwork) await sleep(RATE_MS);
      const gb = await coverFromGoogleBooks(data, { debug: DEBUG });
      touchedNetwork = true;
      if (gb) {
        chosenUrl = gb;
        chosenSource = "google-books";
      }
    }

    if (!chosenUrl && marginalFloor !== null) {
      chosenUrl = marginalFloor;
      chosenSource = "open-library-marginal";
    }

    if (chosenUrl) {
      if (chosenSource === "open-library") counts.fromOpenLibrary++;
      else if (chosenSource === "google-books") counts.fromGoogleBooks++;
      else if (chosenSource === "open-library-marginal") counts.fromOpenLibraryMarginal++;
      printDiff(slug, raw, chosenUrl);
      // Capture chosenUrl in the closure as a const so the pending
      // queue doesn't lose track of which URL belongs to which book.
      const writeUrl = chosenUrl;
      pending.push(() => writeCover(refPath, writeUrl));
    } else {
      counts.noSource++;
    }
    // Rate-limit when any external API was touched, even on a no-match.
    if (touchedNetwork) await sleep(RATE_MS);
  }

  process.stderr.write(
    `\nhardcover: ${counts.fromHardcover} · open-library: ${counts.fromOpenLibrary} · ` +
      `open-library-marginal: ${counts.fromOpenLibraryMarginal} · ` +
      `google-books: ${counts.fromGoogleBooks} · ` +
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
//
// Thin wrapper over `findOpenLibraryCandidate` that exposes only a
// passing URL — kept for the historical test contract and for callers
// that don't want to know about marginal candidates.
export async function coverFromOpenLibrary(frontmatter, { debug = false, fetchImpl = fetch } = {}) {
  const found = await findOpenLibraryCandidate(frontmatter, { debug, fetchImpl });
  if (!found) return null;
  return found.marginal ? null : found.url;
}

// Richer variant: returns `{ url, marginal }` so the caller can decide
// whether to keep a thin-cover ISBN13 candidate as a last resort. A
// marginal hit (covers-API returned a tiny placeholder bytes-length) is
// still a real edition record on Open Library; the renderer can route
// users into the existing cover-picker grid from there. Null means
// "nothing was found in any path."
export async function findOpenLibraryCandidate(
  frontmatter,
  { debug = false, fetchImpl = fetch, preferences = null } = {},
) {
  // Track the best marginal ISBN13 URL — the one we'd surface if every
  // later probe also failed. ISBN13-derived URLs map to a single
  // edition, so even a thin candidate is anchored to a real record.
  let marginalIsbn13Url = null;

  const isbn13 = stringField(frontmatter.isbn13);
  const isbn10 = stringField(frontmatter.isbn);
  // Walk ISBNs in priority order. Track marginal ISBN13 specifically;
  // ISBN10 marginals are not preserved (less stable anchor).
  for (const { kind, value } of orderedIsbns(isbn13, isbn10)) {
    const url = `${OPEN_LIBRARY_COVERS}/isbn/${encodeURIComponent(value)}-L.jpg`;
    if (debug) process.stderr.write(`  probe: ${url}\n`);
    const probe = await probeCover(url, fetchImpl);
    if (probe === "real") return { url, marginal: false };
    if (probe === "marginal" && kind === "isbn13" && !marginalIsbn13Url) {
      marginalIsbn13Url = url;
    }
  }

  // Fall back to title+author search. Open Library's `cover_i` is the
  // canonical cover-id; if present, build a direct URL from it. With
  // language / region preferences, rank the docs before picking.
  const title = stringField(frontmatter.title);
  const author = firstAuthor(frontmatter.authors);
  if (title) {
    const docs = await searchOpenLibraryDocs(title, author, fetchImpl, debug, preferences);
    const picked = pickPreferredCoverId(docs, preferences);
    if (picked !== null) {
      return { url: `${OPEN_LIBRARY_COVERS}/id/${picked}-L.jpg`, marginal: false };
    }
  }

  // Last resort: the marginal ISBN13 candidate, if we saw one. It's a
  // thin cover from Open Library's "no cover" placeholder, but the URL
  // still resolves to an edition page in the cover-picker grid, so the
  // operator has a starting point. Better than null.
  if (marginalIsbn13Url) {
    return { url: marginalIsbn13Url, marginal: true };
  }
  return null;
}

// Google Books Volumes API — a secondary, public, no-auth source. Used
// only when Open Library has nothing usable. Queries `isbn:<isbn13>`
// first, then `intitle:<title>+inauthor:<author>`. HEAD-probes the
// returned `volumeInfo.imageLinks.thumbnail` / `.smallThumbnail` URL
// the same way as the Open Library path so a tiny placeholder doesn't
// land in frontmatter.
//
// Returned URL is the live Google-Books thumbnail link — the renderer
// can swap `&zoom=1` for `&zoom=2` etc. if it wants a larger image; we
// store the canonical thumbnail URL as Google returned it.
export async function coverFromGoogleBooks(frontmatter, { debug = false, fetchImpl = fetch } = {}) {
  const queries = buildGoogleBooksQueries(frontmatter);
  for (const q of queries) {
    const url = `${GOOGLE_BOOKS_VOLUMES}?q=${encodeURIComponent(q)}&maxResults=5`;
    if (debug) process.stderr.write(`  google: ${url}\n`);
    const candidate = await firstGoogleBooksThumbnail(url, fetchImpl);
    if (!candidate) continue;
    if (await isCoverReal(candidate, fetchImpl)) return candidate;
  }
  return null;
}

// Exported so unit tests can pin the query construction without a real
// network round-trip.
export function buildGoogleBooksQueries(frontmatter) {
  const out = [];
  const isbn13 = stringField(frontmatter.isbn13);
  const isbn10 = stringField(frontmatter.isbn);
  if (isbn13) out.push(`isbn:${isbn13}`);
  if (isbn10 && isbn10 !== isbn13) out.push(`isbn:${isbn10}`);
  const title = stringField(frontmatter.title);
  const author = firstAuthor(frontmatter.authors);
  if (title) {
    const parts = [`intitle:${title}`];
    if (author) parts.push(`inauthor:${author}`);
    // Google Books accepts `+` between operators in the raw query;
    // `encodeURIComponent` will turn the space into `%20`, which the
    // API also accepts. Joining on a space keeps the URL readable for
    // debug output and avoids double-encoding `+`.
    out.push(parts.join(" "));
  }
  return out;
}

// Exported for unit tests — pins the response-shape parse independent
// of the HEAD-probe gate. Returns the first non-empty thumbnail URL,
// or null.
export function parseGoogleBooksThumbnail(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  for (const item of items) {
    const links = item?.volumeInfo?.imageLinks;
    if (!links) continue;
    // Prefer `thumbnail` over `smallThumbnail`; both come at the same
    // size from Google but `thumbnail` is the canonical key.
    const candidate = stringField(links.thumbnail) ?? stringField(links.smallThumbnail);
    if (candidate) return candidate;
  }
  return null;
}

async function firstGoogleBooksThumbnail(url, fetchImpl) {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const json = await res.json();
    return parseGoogleBooksThumbnail(json);
  } catch {
    return null;
  }
}

// Ordered, deduplicated ISBN list as { kind, value }. ISBN13 first;
// ISBN10 only if different from the ISBN13.
function orderedIsbns(isbn13, isbn10) {
  const out = [];
  if (isbn13) out.push({ kind: "isbn13", value: isbn13 });
  if (isbn10 && isbn10 !== isbn13) out.push({ kind: "isbn10", value: isbn10 });
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
  return (await probeCover(url, fetchImpl)) === "real";
}

// Tri-state cover probe: distinguishes a hard miss from a marginal
// (the URL resolved but only returned a placeholder-sized payload).
// The marginal state matters for ISBN13 specifically — an ISBN13 hit
// at Open Library still anchors a real edition record, so the
// cover-picker grid can use it as a starting point even when the
// auto-pick gate rejects the thumbnail.
async function probeCover(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { method: "HEAD", redirect: "follow" });
    if (!res.ok) return "miss";
    const len = Number(res.headers.get("content-length") ?? 0);
    // Real Open Library covers are ≥ 5KB even at S; the "no cover"
    // placeholder served by the API is well under 2KB. 3KB is the
    // safe gate.
    if (len >= 3000) return "real";
    if (len > 0) return "marginal";
    return "miss";
  } catch {
    return "miss";
  }
}

// Open Library `/search.json` returns one doc per work. Each doc has
// `cover_i`, plus `language` (array of ISO 639-1 codes), `publisher`
// (array of strings), and `publish_place`. The renderer-side language
// / region preference picks among these instead of taking docs[0].
async function searchOpenLibraryDocs(title, author, fetchImpl, debug, preferences) {
  const params = new URLSearchParams({ title, limit: "5" });
  if (author) params.set("author", author);
  // Honour the language preference at the API layer too — Open Library
  // accepts a `language` filter (ISO 639-3 code, e.g. `eng`). When the
  // caller specifies an ISO 639-1 code we translate the common cases;
  // unknown codes pass through verbatim.
  const apiLang = openLibraryLanguageCode(preferences?.language);
  if (apiLang) params.set("language", apiLang);
  const url = `${OPEN_LIBRARY_SEARCH}?${params.toString()}`;
  if (debug) process.stderr.write(`  search: ${url}\n`);
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.docs) ? json.docs : [];
  } catch {
    return [];
  }
}

// Exported so unit tests can pin the preference logic without a live
// HTTP round-trip. Returns the chosen `cover_i` or null.
export function pickPreferredCoverId(docs, preferences) {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const candidates = docs.filter(
    (d) => typeof d?.cover_i === "number" && Number.isFinite(d.cover_i) && d.cover_i > 0,
  );
  if (candidates.length === 0) return null;
  // Score: language match > region/market match > everything else. The
  // search API already filters by `language=` when supplied, so for
  // language-filtered runs the scoring mostly disambiguates among
  // editions. For un-filtered runs (no `language: <code>` frontmatter)
  // the default-English preference kicks in here.
  const lang = (preferences?.language ?? "en").toLowerCase();
  const region = (preferences?.region ?? null)?.toLowerCase() ?? null;
  let best = candidates[0];
  let bestScore = -1;
  for (const doc of candidates) {
    const score = scoreOpenLibraryDoc(doc, lang, region);
    if (score > bestScore) {
      best = doc;
      bestScore = score;
    }
  }
  return best.cover_i;
}

function scoreOpenLibraryDoc(doc, lang, region) {
  let score = 0;
  const langs = Array.isArray(doc?.language)
    ? doc.language.map((s) => String(s).toLowerCase())
    : [];
  const targetLangs = openLibraryLanguageVariants(lang);
  if (langs.some((l) => targetLangs.includes(l))) score += 2;
  if (region) {
    const haystack = [
      ...(Array.isArray(doc?.publisher) ? doc.publisher : []),
      ...(Array.isArray(doc?.publish_place) ? doc.publish_place : []),
      ...(Array.isArray(doc?.publish_country) ? doc.publish_country : []),
    ]
      .map((s) => String(s).toLowerCase())
      .join(" ");
    const regionTokens = regionTokensFor(region);
    if (regionTokens.some((t) => haystack.includes(t))) score += 1;
  }
  return score;
}

// Open Library uses ISO 639-3 codes in `language` API filters but
// often returns 639-1 in docs[].language. Map the common cases so a
// `language: en` frontmatter value works with either side.
function openLibraryLanguageCode(input) {
  const v = (input ?? "").toLowerCase().trim();
  if (!v) return null;
  const map = { en: "eng", fr: "fre", de: "ger", es: "spa", it: "ita", pt: "por", ja: "jpn" };
  return map[v] ?? v;
}

function openLibraryLanguageVariants(lang) {
  // Accept both 639-1 and 639-3 in the response.
  const v = (lang ?? "").toLowerCase().trim();
  const m = {
    en: ["en", "eng"],
    fr: ["fr", "fre", "fra"],
    de: ["de", "ger", "deu"],
    es: ["es", "spa"],
    it: ["it", "ita"],
    pt: ["pt", "por"],
    ja: ["ja", "jpn"],
  };
  return m[v] ?? [v];
}

// Region tokens: a coarse keyword match against publisher / place /
// country strings. The list intentionally covers only the markets the
// vault frontmatter actually uses today (US, UK) plus a couple of
// adjacent ones; future markets are a one-line addition.
function regionTokensFor(region) {
  const r = (region ?? "").toLowerCase().trim();
  const m = {
    uk: ["united kingdom", "uk", "england", "london", "scotland", "great britain", "britain"],
    gb: ["united kingdom", "uk", "england", "london", "scotland", "great britain", "britain"],
    us: ["united states", "usa", "new york", "york", "boston", "san francisco", "u.s.a"],
    au: ["australia", "sydney", "melbourne"],
    ca: ["canada", "toronto", "vancouver"],
  };
  return m[r] ?? [r];
}

// Read preference fields off the book's frontmatter. The `language`
// field is not yet in `src/lib/types.ts` (agent #1 owns the schema);
// `region` and `edition` are similarly future. This helper treats them
// as optional strings — when present, pass them down; when absent,
// default-English language preference applies. Exported so tests can
// pin the precedence (`language` > `region` > `edition`).
export function readCoverPreferences(frontmatter) {
  const language = stringField(frontmatter?.language);
  // `region:` is the canonical name in the TODO; `edition:` is the
  // adjacent field codified in TODO.md (`edition: paperback | hardcover
  // | UK | audio`). We honour either when it names a market we know.
  const explicitRegion = stringField(frontmatter?.region);
  const edition = stringField(frontmatter?.edition);
  const region = explicitRegion ?? marketFromEdition(edition);
  return { language, region };
}

function marketFromEdition(edition) {
  if (!edition) return null;
  const v = edition.toLowerCase();
  if (v.includes("uk") || v.includes("british")) return "uk";
  if (v.includes("us") || v.includes("american")) return "us";
  if (v.includes("australia")) return "au";
  if (v.includes("canada")) return "ca";
  return null;
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
    if (
      a === "--apply" ||
      a === "--debug" ||
      a === "--no-open-library" ||
      a === "--no-google-books"
    ) {
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
