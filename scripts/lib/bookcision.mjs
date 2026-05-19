// Pure helpers for the Bookcision JSON importer. Network-free so the
// parsing, matching, dedupe-state, and rendering logic can be unit-tested
// without filesystem IO.
//
// Bookcision schema (from the upstream `excisor/Book.js` source):
//
//   {
//     "asin": "B00AA36R4U",
//     "title": "CLR via C# (Microsoft, Developer Reference)",
//     "authors": "Jeffrey Richter",
//     "highlights": [
//       {
//         "text": "the highlighted text",
//         "isNoteOnly": false,
//         "location": { "url": "https://read.amazon.com/?asin=...&location=132", "value": 132 },
//         "note": "optional reader-typed note"
//       },
//       ...
//     ]
//   }
//
// Each highlight's `location.value` is the Kindle location integer; the
// `location.url` is the deep-link back to that location in the reader.
// `isNoteOnly: true` means the entry is a standalone reader note (no
// underlying highlight); `note` on a non-note-only entry is a comment
// attached to the highlight text. Page numbers are NOT in the schema —
// Bookcision works off the Kindle reader's `location` only.
//
// The `quotes.md` shape this lib emits has a stable `## From Kindle
// highlights` heading. Per-entry dedupe hashes ride in HTML-comment
// trailers (`<!-- bookcision-hash:XXXX -->`), keeping the rendered
// markdown clean while letting re-runs find what's already been written.

import crypto from "node:crypto";

const SECTION_TITLE = "From Kindle highlights";
const SECTION_HEADING = `## ${SECTION_TITLE}`;
const HASH_PREFIX = "bookcision-hash:";

/**
 * @typedef {object} ParsedBookcisionHighlight
 * @property {string} text                 - the highlighted text (or note body when isNoteOnly)
 * @property {boolean} isNoteOnly          - true when the entry is a standalone reader note
 * @property {number | null} location      - Kindle location integer, when parseable
 * @property {string | null} url           - deep-link URL into the Kindle reader, when present
 * @property {string | null} note          - reader-typed annotation attached to a highlight
 * @property {string} hash                 - 16-char dedupe key
 */

/**
 * @typedef {object} ParsedBookcision
 * @property {string | null} asin          - Amazon ASIN if present (10 chars, mixed alphanumeric)
 * @property {string} title                - book title from Bookcision
 * @property {string | null} authors       - author string from Bookcision (single field, may be a list)
 * @property {ParsedBookcisionHighlight[]} highlights - parsed, in input order
 */

/**
 * Parse a Bookcision JSON payload (already JSON.parsed by the caller)
 * into a typed record. Throws when the shape doesn't carry the
 * load-bearing fields (`title` + `highlights[]`); tolerant of missing
 * optional ones (asin / authors / per-highlight location / note).
 *
 * @param {unknown} raw - the JSON-decoded payload
 * @returns {ParsedBookcision}
 */
export function parseBookcision(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("not a Bookcision payload (root is not an object)");
  }
  /** @type {Record<string, unknown>} */
  const obj = raw;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (title.length === 0) {
    throw new Error("not a Bookcision payload (missing title)");
  }
  if (!Array.isArray(obj.highlights)) {
    throw new Error("not a Bookcision payload (missing highlights array)");
  }

  const asin = typeof obj.asin === "string" && obj.asin.length > 0 ? obj.asin : null;
  const authors = typeof obj.authors === "string" && obj.authors.length > 0 ? obj.authors : null;

  /** @type {ParsedBookcisionHighlight[]} */
  const highlights = [];
  for (const h of obj.highlights) {
    if (!h || typeof h !== "object" || Array.isArray(h)) continue;
    const text = typeof h.text === "string" ? h.text.trim() : "";
    if (text.length === 0) continue;
    const isNoteOnly = h.isNoteOnly === true;
    const note = typeof h.note === "string" && h.note.trim().length > 0 ? h.note.trim() : null;

    let location = null;
    let url = null;
    if (h.location && typeof h.location === "object" && !Array.isArray(h.location)) {
      const loc = /** @type {Record<string, unknown>} */ (h.location);
      const v = loc.value;
      if (typeof v === "number" && Number.isFinite(v)) location = Math.trunc(v);
      else if (typeof v === "string") {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n)) location = n;
      }
      if (typeof loc.url === "string" && loc.url.length > 0) url = loc.url;
    }

    highlights.push({
      text,
      isNoteOnly,
      location,
      url,
      note,
      hash: hashHighlight({ text, isNoteOnly, note }),
    });
  }

  return { asin, title, authors, highlights };
}

/**
 * Stable hash for dedupe. Hashes the load-bearing fields only — text,
 * kind, and the attached note. Location is intentionally excluded:
 * Bookcision's location values can shift when a book's edition is
 * re-paginated by Amazon, and the same highlighted text under a
 * recomputed location is still the same highlight.
 *
 * @param {{ text: string, isNoteOnly: boolean, note: string | null }} parts
 * @returns {string}
 */
export function hashHighlight({ text, isNoteOnly, note }) {
  const h = crypto.createHash("sha256");
  h.update(isNoteOnly ? "note" : "highlight");
  h.update("\0");
  h.update(text.replace(/\s+/g, " ").trim());
  h.update("\0");
  h.update(note ?? "");
  return h.digest("hex").slice(0, 16);
}

/**
 * Normalise a title for fuzzy comparison: lowercase, strip non-alnum,
 * collapse whitespace. Mirrors the helper in scripts/lib/kindle-clippings.mjs
 * so the two import paths agree on what "same title" means.
 *
 * @param {string} title
 * @returns {string}
 */
export function normaliseTitle(title) {
  return title
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Match a Bookcision payload to a vault slug. ASIN match wins when both
 * sides carry one; otherwise falls back to title matching against the
 * indexed vault titles. The substring-with-length-floor heuristic
 * matches scripts/lib/kindle-clippings.mjs so the two importers behave
 * the same on title-only joins.
 *
 * @param {ParsedBookcision} parsed
 * @param {Array<{ slug: string, title: string, asin?: string | null }>} vaultEntries
 * @returns {{ slug: string, via: "asin" | "title-exact" | "title-substring" } | null}
 */
export function matchBookcisionToVault(parsed, vaultEntries) {
  if (parsed.asin) {
    for (const e of vaultEntries) {
      if (typeof e.asin === "string" && e.asin === parsed.asin) {
        return { slug: e.slug, via: "asin" };
      }
    }
  }

  const want = normaliseTitle(parsed.title).replace(/\s+/g, "");
  if (want.length === 0) return null;

  // Pass 1: exact normalised equality.
  for (const e of vaultEntries) {
    const have = normaliseTitle(e.title).replace(/\s+/g, "");
    if (have === want) return { slug: e.slug, via: "title-exact" };
  }

  // Pass 2: substring containment with length floors. Mirror the
  // kindle-clippings matcher's discipline — at least 6 chars on the
  // shorter side, and the shorter must be ≥ 35% of the longer's length.
  let bestSlug = null;
  let bestQuality = 0;
  for (const e of vaultEntries) {
    const have = normaliseTitle(e.title).replace(/\s+/g, "");
    if (have.length === 0) continue;
    const [shorter, longer] = have.length <= want.length ? [have, want] : [want, have];
    if (shorter.length < 6) continue;
    if (shorter.length / longer.length < 0.35) continue;
    if (longer.includes(shorter)) {
      const quality = shorter.length / longer.length;
      if (quality > bestQuality) {
        bestQuality = quality;
        bestSlug = e.slug;
      }
    }
  }
  if (bestSlug !== null) return { slug: bestSlug, via: "title-substring" };

  return null;
}

/**
 * Render a single highlight into the markdown block emitted under the
 * `## From Kindle highlights` heading: a blockquote (one line per body
 * line so multi-line highlights stay quoted), an italicised attribution
 * line, and a trailing HTML-comment carrying the dedupe hash. The note
 * (when present) renders as an indented prose line under the blockquote
 * so the reader's own annotation sits beside the highlighted text.
 *
 * @param {ParsedBookcisionHighlight} h
 * @returns {string}
 */
export function renderHighlight(h) {
  const lines = [];
  if (h.isNoteOnly) {
    // Standalone reader note — no underlying highlight body. Render as
    // an italicised "Note:" paragraph so it reads differently from the
    // blockquote-shaped highlights below it.
    lines.push(...h.text.split("\n").map((line) => `> *Note:* ${line}`));
  } else {
    lines.push(...h.text.split("\n").map((line) => `> ${line}`));
  }
  if (h.note && !h.isNoteOnly) {
    lines.push("");
    lines.push(...h.note.split("\n").map((line) => `> — ${line}`));
  }
  lines.push("");
  lines.push(`*— ${renderAttribution(h)}*`);
  lines.push(`<!-- ${HASH_PREFIX}${h.hash} -->`);
  return lines.join("\n");
}

/**
 * Build the "Location 1234" suffix (or "from Kindle" when location is
 * absent). Bookcision JSON carries the location URL but never a page
 * number — Kindle locations are the source-of-truth coordinate.
 *
 * @param {ParsedBookcisionHighlight} h
 * @returns {string}
 */
export function renderAttribution(h) {
  if (h.location !== null) return `Location ${h.location}`;
  return "from Kindle";
}

/**
 * Extract the set of dedupe hashes already present in an existing
 * `quotes.md`. Re-runs use this to skip entries we've already written.
 *
 * @param {string} quotesMarkdown
 * @returns {Set<string>}
 */
export function extractExistingHashes(quotesMarkdown) {
  const hashes = new Set();
  const re = /<!--\s*bookcision-hash:([0-9a-f]+)\s*-->/g;
  let m;
  while ((m = re.exec(quotesMarkdown)) !== null) hashes.add(m[1]);
  return hashes;
}

/**
 * Compute the new `quotes.md` contents after appending a batch of fresh
 * highlights to a (possibly empty) existing file. Entries already
 * present (by hash) are filtered out. The `## From Kindle highlights`
 * H2 is created when missing and reused when present, so a second run
 * produces zero diff and a third run with new highlights appends inside
 * the same section.
 *
 * @param {string} existing - the current contents of quotes.md, or ""
 * @param {ParsedBookcisionHighlight[]} fresh
 * @returns {{ next: string, written: ParsedBookcisionHighlight[] }}
 */
export function appendHighlights(existing, fresh) {
  const seen = extractExistingHashes(existing);
  const newOnes = fresh.filter((h) => !seen.has(h.hash));
  if (newOnes.length === 0) return { next: existing, written: [] };

  const rendered = newOnes.map(renderHighlight).join("\n\n");
  const next = appendIntoSection(existing, SECTION_TITLE, rendered);
  return { next, written: newOnes };
}

/**
 * Append rendered markdown into the named H2 section, creating the
 * section if it doesn't exist. Inserts before the next H2 (or at end
 * of file). Preserves a trailing newline.
 *
 * @param {string} existing
 * @param {string} sectionTitle
 * @param {string} rendered
 * @returns {string}
 */
function appendIntoSection(existing, sectionTitle, rendered) {
  const sectionRe = new RegExp(`^##\\s+${escapeRegex(sectionTitle)}\\s*$`, "m");
  const sectionMatch = sectionRe.exec(existing);

  if (!sectionMatch) {
    const sep =
      existing.length === 0 || existing.endsWith("\n\n")
        ? ""
        : existing.endsWith("\n")
          ? "\n"
          : "\n\n";
    return `${existing}${sep}## ${sectionTitle}\n\n${rendered}\n`;
  }

  // Insert just before the next H2 (or at EOF). Pad with a blank line so
  // the new entries are separated from whatever came last in the section.
  const afterHeading = sectionMatch.index + sectionMatch[0].length;
  const nextH2 = /\n##\s+/g;
  nextH2.lastIndex = afterHeading;
  const nextMatch = nextH2.exec(existing);
  const sectionEnd = nextMatch ? nextMatch.index : existing.length;

  const before = existing.slice(0, sectionEnd).replace(/\s*$/, "");
  const after = existing.slice(sectionEnd);
  return `${before}\n\n${rendered}\n${after.length > 0 ? "\n" + after.replace(/^\n+/, "") : ""}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Stable JSON serialiser used by the idempotency-state writer. Sorts
 * keys at every depth so two equivalent objects with different key
 * insertion orders stringify identically. Mirrors `stableStringify`
 * in scripts/lib/hardcover-sync.mjs so the two scripts agree on what
 * "identical" means.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === undefined) return JSON.stringify(null);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => (v === undefined ? "null" : stableStringify(v)));
    return `[${parts.join(",")}]`;
  }
  /** @type {Record<string, unknown>} */
  const obj = value;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/**
 * Build the per-file state-cache entry. Records the set of highlight
 * hashes that were materialised into the vault from this file, plus a
 * stable digest of the source-file's parsed contents so we can detect
 * "same path, different file" (operator overwrote the export).
 *
 * @param {string} slug                                 - vault slug the file was matched to
 * @param {ParsedBookcision} parsed                     - parsed payload
 * @param {ParsedBookcisionHighlight[]} writtenHighlights - the subset actually appended
 * @returns {{ slug: string, sourceDigest: string, hashes: string[], highlightCount: number }}
 */
export function buildStateEntry(slug, parsed, writtenHighlights) {
  const digestInput = stableStringify({
    asin: parsed.asin,
    title: parsed.title,
    authors: parsed.authors,
    highlights: parsed.highlights.map((h) => ({
      text: h.text,
      isNoteOnly: h.isNoteOnly,
      note: h.note,
      location: h.location,
    })),
  });
  const sourceDigest = crypto.createHash("sha256").update(digestInput).digest("hex").slice(0, 16);
  const hashes = parsed.highlights.map((h) => h.hash).sort();
  return {
    slug,
    sourceDigest,
    hashes,
    highlightCount: writtenHighlights.length,
  };
}

/**
 * Decide whether re-processing a Bookcision file is a no-op. A file is
 * a no-op when (a) the state file already carries an entry for the
 * file's path, AND (b) the recorded source-digest matches the freshly-
 * parsed file. Differing digests mean the operator has re-exported the
 * book (more highlights since last time) — the importer should still
 * run, dedupe by per-highlight hash will catch the overlap.
 *
 * @param {object | null | undefined} previousEntry - prior state entry, or null
 * @param {ParsedBookcision} parsed                  - freshly-parsed payload
 * @returns {boolean}
 */
export function isStateNoOp(previousEntry, parsed) {
  if (!previousEntry || typeof previousEntry !== "object") return false;
  const previousDigest = /** @type {Record<string, unknown>} */ (previousEntry).sourceDigest;
  if (typeof previousDigest !== "string" || previousDigest.length === 0) return false;
  const fresh = buildStateEntry("", parsed, []);
  return fresh.sourceDigest === previousDigest;
}

/**
 * Decide whether the on-disk state file needs to be (re)written and
 * what to put in it. Pure — caller does the I/O. Skips a write when
 * the new entries serialise to the same bytes as the existing entries
 * so the auto-hygiene workflow doesn't churn a no-op commit.
 *
 * @param {object} args
 * @param {Record<string, unknown>} args.newEntries
 * @param {Record<string, unknown> | null | undefined} args.existing
 * @param {string} args.generator
 * @param {() => string} args.now
 * @returns {{ write: false; reason: string } | { write: true; contents: string }}
 */
export function decideStateWrite({ newEntries, existing, generator, now }) {
  const existingEntries = existing?.entries ?? {};
  if (stableStringify(newEntries) === stableStringify(existingEntries)) {
    return { write: false, reason: "entries unchanged" };
  }
  const out = {
    updated: now(),
    generator,
    entries: newEntries,
  };
  return { write: true, contents: JSON.stringify(out, null, 2) + "\n" };
}

/**
 * Section heading the importer writes under (exported so the script can
 * print it in dry-run summaries).
 */
export const KINDLE_HIGHLIGHTS_HEADING = SECTION_HEADING;
