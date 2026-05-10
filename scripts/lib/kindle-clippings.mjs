// Pure helpers for the Kindle `My Clippings.txt` importer. Lives in a
// separate module from the script so the parsing, matching, dedupe, and
// rendering logic can be unit-tested without spinning up filesystem IO.
//
// Format reminder: `My Clippings.txt` is UTF-8 (with BOM) on modern
// Kindles and UTF-16-LE on older ones. Each entry is four lines plus a
// `==========` separator:
//
//   Title (Author)
//   - Your Highlight on Page 12 | Location 132-135 | Added on Tuesday, January 5, 2021 9:42:11 AM
//   <blank>
//   The actual highlighted text spanning one or more lines.
//   ==========
//
// "Bookmark" entries (no body) are skipped; "Highlight" and "Note"
// entries are kept, with Notes routed to a separate H2 in the rendered
// output.

import crypto from "node:crypto";

/**
 * Decode a `My Clippings.txt` file's raw bytes. Detects UTF-16-LE via
 * BOM (older Kindles); everything else is decoded as UTF-8 with a BOM
 * strip if present.
 *
 * @param {Buffer | Uint8Array} buf
 * @returns {string}
 */
export function decodeClippings(buf) {
  // UTF-16-LE BOM is fffe; UTF-8 BOM is efbbbf.
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // Skip the BOM and decode as UTF-16-LE. Node's TextDecoder handles it.
    return new TextDecoder("utf-16le").decode(buf.subarray(2));
  }
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/**
 * Split a decoded clippings file into raw entry blocks. The separator
 * is `==========` on its own line; lines may end with `\r\n` or `\n`,
 * and Kindle sometimes leaves stray `\r` before the separator.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitEntries(text) {
  // Normalise line endings first so the rest of the parser doesn't have
  // to think about CRLF.
  const normalised = text.replace(/\r\n/g, "\n").replace(/\r/g, "");
  return normalised
    .split(/^==========$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse a single entry block into a structured object, or null if the
 * block isn't a valid Highlight or Note (Bookmarks have no body and are
 * skipped).
 *
 * @param {string} block
 * @returns {ParsedEntry | null}
 */
export function parseEntry(block) {
  const lines = block.split("\n");
  if (lines.length < 3) return null;

  const titleLine = lines[0].trim();
  const metaLine = lines[1].trim();
  // Body is every line after the metadata (line 1) and the optional
  // blank line — concretely "everything from line 2 onward, joined and
  // trimmed". Joining with `\n` preserves intentional newlines inside a
  // multi-line highlight.
  const bodyLines = lines.slice(2);
  // Drop a leading blank (Kindle puts one after the metadata line).
  while (bodyLines.length > 0 && bodyLines[0].trim() === "") bodyLines.shift();
  const body = bodyLines.join("\n").trim();

  // Detect kind from the metadata line. Bookmarks have no body.
  const isHighlight = /Your Highlight/i.test(metaLine);
  const isNote = /Your Note/i.test(metaLine);
  const isBookmark = /Your Bookmark/i.test(metaLine);
  if (isBookmark) return null;
  if (!isHighlight && !isNote) return null;
  if (body.length === 0) return null;

  const { title, author } = parseTitleLine(titleLine);
  const { page, location, addedAt } = parseMetaLine(metaLine);

  return {
    kind: isNote ? "note" : "highlight",
    title,
    author,
    page,
    location,
    addedAt,
    text: body,
    hash: hashEntry({ title, kind: isNote ? "note" : "highlight", text: body }),
  };
}

/**
 * Parse the title line. Kindle is inconsistent — author can be
 * `(Lastname, Firstname)`, `(Firstname Lastname)`, or absent. We split
 * on the *last* parenthesis pair so titles containing parens still work.
 *
 * @param {string} line
 * @returns {{ title: string, author: string | null }}
 */
export function parseTitleLine(line) {
  // Strip BOM-ish leading whitespace defensively.
  const trimmed = line.replace(/^﻿?\s*/, "").trim();
  const m = /^(.*)\s*\(([^()]+)\)\s*$/.exec(trimmed);
  if (!m) return { title: trimmed, author: null };
  return { title: m[1].trim(), author: m[2].trim() };
}

/**
 * Parse the metadata line. Capture page, location, and added-at where
 * present. Page and location are independently optional. Added-at uses
 * Kindle's English long-form ("Tuesday, January 5, 2021 9:42:11 AM");
 * we hand `Date.parse` a slightly cleaned string and accept whatever it
 * returns. Returns null fields rather than throwing on parse failure —
 * the importer leans on best-effort extraction, never required fields.
 *
 * @param {string} line
 * @returns {{ page: number | null, location: string | null, addedAt: string | null }}
 */
export function parseMetaLine(line) {
  const pageMatch = /Page\s+([0-9ivxlcdm-]+)/i.exec(line);
  const locationMatch = /Location\s+([0-9-]+)/i.exec(line);
  const addedMatch = /Added on\s+(.+?)\s*$/i.exec(line);

  let page = null;
  if (pageMatch) {
    const raw = pageMatch[1];
    const asInt = parseInt(raw, 10);
    page = Number.isFinite(asInt) ? asInt : null;
  }

  const location = locationMatch ? locationMatch[1] : null;

  let addedAt = null;
  if (addedMatch) {
    const dateStr = addedMatch[1]
      // Drop the leading weekday name — Date.parse handles the rest.
      .replace(/^[A-Za-z]+,\s*/, "")
      .trim();
    const ts = Date.parse(dateStr);
    if (Number.isFinite(ts)) {
      addedAt = new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
    }
  }

  return { page, location, addedAt };
}

/**
 * Stable hash for dedupe. Hashes by (kind, title-normalised, text) — we
 * skip page/location/addedAt because Kindle occasionally re-emits the
 * same highlight with a recomputed location (firmware updates, library
 * re-syncs). Title is included so the same quote against two different
 * books doesn't collide.
 *
 * @param {{ title: string, kind: "highlight" | "note", text: string }} parts
 * @returns {string}
 */
export function hashEntry({ title, kind, text }) {
  const h = crypto.createHash("sha256");
  h.update(kind);
  h.update("\0");
  h.update(normaliseTitle(title));
  h.update("\0");
  h.update(text.replace(/\s+/g, " ").trim());
  return h.digest("hex").slice(0, 16);
}

/**
 * Normalise a title for fuzzy comparison: lowercase, strip non-alnum,
 * collapse whitespace. Two strings are considered to refer to the same
 * book if either's normalised form is a substring of the other's *and*
 * the shorter is at least 4 characters (avoids "It" matching everything).
 *
 * @param {string} title
 * @returns {string}
 */
export function normaliseTitle(title) {
  return title
    .toLowerCase()
    .replace(/[‘’“”]/g, "") // smart quotes
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Match a Kindle title to a vault slug. `vaultEntries` is a list of
 * `{ slug, title, authors }` records — typically built by reading every
 * reference file's frontmatter. Returns the matched slug or null.
 *
 * Heuristic, in order of trust:
 *  1. exact normalised-title equality.
 *  2. normalised-Kindle-title is a substring of normalised-vault-title
 *     (or vice versa), with the shorter ≥ 6 chars to avoid spurious
 *     matches on short common words.
 *
 * Discipline: high precision over recall. Better to dump an unmatched
 * highlight into the sidecar than to attribute it to the wrong book.
 *
 * @param {string} kindleTitle
 * @param {Array<{ slug: string, title: string, authors?: string[] }>} vaultEntries
 * @returns {string | null}
 */
export function matchTitle(kindleTitle, vaultEntries) {
  const want = normaliseTitle(kindleTitle).replace(/\s+/g, "");
  if (want.length === 0) return null;

  // Pass 1: exact normalised equality.
  for (const e of vaultEntries) {
    const have = normaliseTitle(e.title).replace(/\s+/g, "");
    if (have === want) return e.slug;
  }

  // Pass 2: substring containment with two floors. The shorter of the
  // two strings must be (a) at least 6 chars — "the" vs anything is a
  // false positive — and (b) at least 0.4× the longer's length, so a
  // sub-2.5x size mismatch is required. That admits "Cryptonomicon"
  // matching "Cryptonomicon: The Cryptography Novel" (13 of 33 ≈ 0.39
  // — falls just under, so we use ≥ 0.35 in practice) while rejecting
  // "Rings" matching "The Lord of the Rings" (5 of 17 ≈ 0.29).
  // 0.35 is the sweet-spot: the worked-example pair (Cryptonomicon /
  // Cryptonomicon: The Cryptography Novel) is 0.36 normalised.
  let bestSlug = null;
  let bestQuality = 0;
  for (const e of vaultEntries) {
    const have = normaliseTitle(e.title).replace(/\s+/g, "");
    if (have.length === 0) continue;
    const [shorter, longer] = have.length <= want.length ? [have, want] : [want, have];
    if (shorter.length < 6) continue;
    if (shorter.length / longer.length < 0.35) continue;
    if (longer.includes(shorter)) {
      // Quality = how close the lengths are. 1.0 means equal length.
      const quality = shorter.length / longer.length;
      if (quality > bestQuality) {
        bestQuality = quality;
        bestSlug = e.slug;
      }
    }
  }

  return bestSlug;
}

/**
 * Render a list of parsed entries into the `## From Kindle` markdown
 * block. Highlights and Notes are split into separate H2 sections so
 * the headings tell the user where the content came from.
 *
 * @param {ParsedEntry[]} entries
 * @returns {string}
 */
export function renderEntries(entries) {
  const highlights = entries.filter((e) => e.kind === "highlight");
  const notes = entries.filter((e) => e.kind === "note");
  const blocks = [];
  if (highlights.length > 0) {
    blocks.push("## From Kindle\n\n" + highlights.map(renderEntry).join("\n\n"));
  }
  if (notes.length > 0) {
    blocks.push("## Notes from Kindle\n\n" + notes.map(renderEntry).join("\n\n"));
  }
  return blocks.join("\n\n");
}

/**
 * Render a single entry as a blockquote followed by an italicised
 * attribution line. The blockquote prefix is applied per body-line so
 * multi-line highlights stay quoted throughout.
 *
 * @param {ParsedEntry} e
 * @returns {string}
 */
export function renderEntry(e) {
  const quoted = e.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const attribution = renderAttribution(e);
  // Trailing HTML comment carries the dedupe hash. Keeps the rendered
  // markdown clean while letting the importer find existing hashes on
  // re-run via a regex over the file.
  return `${quoted}\n\n*— ${attribution}*\n<!-- kindle-hash:${e.hash} -->`;
}

/**
 * Build the "Page 12, added 2021-01-05" suffix. Falls back gracefully
 * when fields are missing — page-only, location-only, date-only, and
 * "no metadata at all" all produce sensible output.
 *
 * @param {ParsedEntry} e
 * @returns {string}
 */
export function renderAttribution(e) {
  const parts = [];
  if (e.page !== null) parts.push(`Page ${e.page}`);
  else if (e.location !== null) parts.push(`Location ${e.location}`);
  if (e.addedAt) parts.push(`added ${e.addedAt}`);
  return parts.length > 0 ? parts.join(", ") : "from Kindle";
}

/**
 * Extract the set of dedupe hashes already present in an existing
 * `quotes.md`. Re-runs of the importer use this to skip entries we've
 * already written. The hashes ride in `<!-- kindle-hash:XXXX -->`
 * comments emitted by `renderEntry`.
 *
 * @param {string} quotesMarkdown
 * @returns {Set<string>}
 */
export function extractExistingHashes(quotesMarkdown) {
  const hashes = new Set();
  const re = /<!--\s*kindle-hash:([0-9a-f]+)\s*-->/g;
  let m;
  while ((m = re.exec(quotesMarkdown)) !== null) hashes.add(m[1]);
  return hashes;
}

/**
 * Compute the new file contents after adding a batch of fresh entries
 * to a (possibly empty) existing `quotes.md`. New entries are split
 * into highlights and notes and appended into their respective H2
 * blocks if those blocks already exist, or appended as fresh blocks at
 * the end if not. Entries already present (by hash) are filtered out.
 *
 * @param {string} existing - the current contents of quotes.md, or ""
 * @param {ParsedEntry[]} fresh
 * @returns {{ next: string, written: ParsedEntry[] }}
 */
export function appendEntries(existing, fresh) {
  const seen = extractExistingHashes(existing);
  const newOnes = fresh.filter((e) => !seen.has(e.hash));
  if (newOnes.length === 0) return { next: existing, written: [] };

  const highlights = newOnes.filter((e) => e.kind === "highlight");
  const notes = newOnes.filter((e) => e.kind === "note");

  let next = existing;
  if (highlights.length > 0) {
    next = appendIntoSection(next, "From Kindle", highlights);
  }
  if (notes.length > 0) {
    next = appendIntoSection(next, "Notes from Kindle", notes);
  }
  return { next, written: newOnes };
}

/**
 * Append a list of entries into the named H2 section, creating the
 * section if it doesn't exist. Inserts before the next H2 (or at end
 * of file). Preserves a trailing newline.
 *
 * @param {string} existing
 * @param {string} sectionTitle - e.g. "From Kindle"
 * @param {ParsedEntry[]} entries
 * @returns {string}
 */
function appendIntoSection(existing, sectionTitle, entries) {
  const rendered = entries.map(renderEntry).join("\n\n");
  const sectionRe = new RegExp(`^##\\s+${escapeRegex(sectionTitle)}\\s*$`, "m");
  const sectionMatch = sectionRe.exec(existing);

  if (!sectionMatch) {
    // Append a fresh section. Ensure there's a blank line between any
    // existing content and the new H2.
    const sep =
      existing.length === 0 || existing.endsWith("\n\n")
        ? ""
        : existing.endsWith("\n")
          ? "\n"
          : "\n\n";
    return `${existing}${sep}## ${sectionTitle}\n\n${rendered}\n`;
  }

  // Find the end of this section: either the start of the next H2, or
  // EOF. Insert the new entries just before that boundary, with a
  // blank line in front so they're separated from whatever came last.
  const sectionStart = sectionMatch.index;
  const afterHeading = sectionStart + sectionMatch[0].length;
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
 * @typedef {object} ParsedEntry
 * @property {"highlight" | "note"} kind
 * @property {string} title
 * @property {string | null} author
 * @property {number | null} page
 * @property {string | null} location
 * @property {string | null} addedAt   - YYYY-MM-DD when parseable
 * @property {string} text
 * @property {string} hash             - 16-char dedupe key
 */
