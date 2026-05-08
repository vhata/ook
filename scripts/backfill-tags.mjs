#!/usr/bin/env node
// Walks the vault and backfills `tags` for books that don't have any,
// querying Open Library by ISBN13 (when present) or by title+author
// search. Open Library subjects are noisy — most of the work here is
// the curated mapping into the existing vault vocabulary.
//
// Vocabulary inspired by what the originally-fleshed-out books carry
// (scifi, fantasy, literary, atmospheric, mystery, hard-scifi,
// portal-fantasy, magic-school, epistolary, time-travel, etc.). Better
// to under-tag than tag with noise; subjects that don't map to a
// known tag are dropped.
//
// Defaults to **dry-run** (prints proposed tags). Pass `--apply` to
// rewrite the vault files.
//
// Usage:
//   node scripts/backfill-tags.mjs --vault PATH [--apply] [--max N]
//                                  [--limit-tags N] [--rate-ms MS]

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const MAX_BOOKS = argv.max !== undefined ? Number(argv.max) : Infinity;
const TAG_LIMIT = Number(argv["limit-tags"] ?? 5);
const RATE_MS = Number(argv["rate-ms"] ?? 700); // Open Library asks for ≤100 req/min

// Controlled vocabulary — pulled up here (above `await main()`) so
// the helper functions don't hit a temporal-dead-zone error when
// they reference it during the first iteration.
//
// Open Library subjects are a soup: "Science fiction", "American
// literature", "Books -- Reviews", etc. Map permissively (substring
// + lowercased) into the existing vault tag style.
//
// Order matters where multiple rules could match: the FIRST match
// wins per subject. Put more specific rules first so e.g. "hard
// science fiction" beats "science fiction".
const VOCAB = [
  // Subgenres / specifics.
  { match: ["hard science fiction", "hard sf"], tag: "hard-scifi" },
  { match: ["space opera"], tag: "space-opera" },
  { match: ["military science fiction"], tag: "military-scifi" },
  { match: ["cyberpunk"], tag: "cyberpunk" },
  { match: ["post-apocalyptic", "postapocalyptic", "post apocalypse"], tag: "post-apocalyptic" },
  { match: ["dystopia"], tag: "dystopia" },
  { match: ["alternate history", "alternative history"], tag: "alt-history" },
  { match: ["time travel"], tag: "time-travel" },
  { match: ["first contact"], tag: "first-contact" },
  { match: ["epic fantasy", "high fantasy"], tag: "epic-fantasy" },
  { match: ["urban fantasy"], tag: "urban-fantasy" },
  { match: ["dark fantasy"], tag: "dark-fantasy" },
  { match: ["sword and sorcery", "sword & sorcery"], tag: "sword-and-sorcery" },
  { match: ["portal fantasy"], tag: "portal-fantasy" },
  { match: ["magic school", "school of magic"], tag: "magic-school" },
  { match: ["progression fantasy", "litrpg"], tag: "progression-fantasy" },
  { match: ["cozy mystery", "cosy mystery"], tag: "cosy-mystery" },
  { match: ["noir", "hardboiled"], tag: "noir" },
  { match: ["thriller"], tag: "thriller" },
  { match: ["horror"], tag: "horror" },
  { match: ["weird fiction", "the weird"], tag: "weird" },
  { match: ["gothic"], tag: "gothic" },
  { match: ["historical fiction"], tag: "historical" },

  // Forms.
  {
    match: ["short stories", "story collection", "stories collection", "anthologies", "anthology"],
    tag: "short-stories",
  },
  { match: ["novella"], tag: "novella" },
  { match: ["epistolary"], tag: "epistolary" },
  { match: ["graphic novels", "comics"], tag: "comics" },
  { match: ["poetry"], tag: "poetry" },
  { match: ["essays"], tag: "essays" },
  { match: ["memoir", "autobiography"], tag: "memoir" },
  { match: ["biography"], tag: "biography" },

  // Demographic.
  { match: ["young adult", "ya fiction"], tag: "ya" },
  { match: ["middle grade"], tag: "middle-grade" },
  { match: ["children's fiction", "juvenile fiction"], tag: "childrens" },

  // Themes / mood.
  { match: ["romance"], tag: "romance" },
  { match: ["adventure"], tag: "adventure" },
  { match: ["coming of age", "coming-of-age"], tag: "coming-of-age" },
  { match: ["humor", "humour", "comic novels"], tag: "humour" },

  // Top-level genres — last so subgenres get priority.
  { match: ["science fiction", "sf, sci-fi", "speculative fiction"], tag: "scifi" },
  { match: ["fantasy fiction", "fantasy"], tag: "fantasy" },
  { match: ["mystery", "detective", "mystery and detective"], tag: "mystery" },
  { match: ["literary fiction", "literature"], tag: "literary" },
  { match: ["nonfiction", "non-fiction"], tag: "nonfiction" },
  { match: ["philosophy"], tag: "philosophy" },
  { match: ["psychology"], tag: "psychology" },
  { match: ["history"], tag: "history" },
  { match: ["science"], tag: "science" },
  { match: ["technology"], tag: "technology" },
];

await main();

async function main() {
  const books = await readVault(VAULT);
  const candidates = books.filter((b) => b.tags.length === 0).slice(0, MAX_BOOKS);

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${books.length} total · ${candidates.length} need tags\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY (will rewrite files)" : "dry-run"}\n`);
  process.stderr.write(`rate: ~${(60000 / RATE_MS).toFixed(0)} req/min\n\n`);

  let touched = 0;
  let totalTags = 0;
  for (const [i, book] of candidates.entries()) {
    process.stderr.write(`[${i + 1}/${candidates.length}] ${book.slug}…`);

    let subjects;
    try {
      subjects = await fetchSubjects(book);
    } catch (e) {
      process.stderr.write(` ERROR: ${e.message}\n`);
      continue;
    }

    if (subjects.length === 0) {
      process.stderr.write(" (no subjects)\n");
      await sleep(RATE_MS);
      continue;
    }

    const tags = mapToVocab(subjects, TAG_LIMIT);
    if (tags.length === 0) {
      process.stderr.write(` (no vocab match in ${subjects.length} subjects)\n`);
      await sleep(RATE_MS);
      continue;
    }

    process.stderr.write(` → [${tags.join(", ")}]\n`);
    touched++;
    totalTags += tags.length;

    if (APPLY) {
      await writeUpdatedTags(book.path, tags);
    }
    await sleep(RATE_MS);
  }

  process.stderr.write(
    `\n${touched} books would gain tags (${totalTags} total)\n` +
      (APPLY ? "" : "(dry-run; rerun with --apply to write)\n"),
  );
}

// Open Library has two relevant endpoints:
//   - Books API by ISBN: returns publication metadata + subjects.
//   - Search API: returns work IDs by title+author; the work then
//     has subjects.
//
// Try ISBN first (more accurate), fall back to search.
async function fetchSubjects(book) {
  if (book.isbn13) {
    const subjects = await fetchByIsbn(book.isbn13);
    if (subjects.length > 0) return subjects;
  }
  if (book.isbn) {
    const subjects = await fetchByIsbn(book.isbn);
    if (subjects.length > 0) return subjects;
  }
  return await fetchBySearch(book.title, book.authors[0]);
}

async function fetchByIsbn(isbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(
    isbn,
  )}&jscmd=data&format=json`;
  const data = await getJson(url);
  const key = `ISBN:${isbn}`;
  const entry = data?.[key];
  if (!entry) return [];
  const subjects = [
    ...(entry.subjects ?? []),
    ...(entry.subject_places ?? []),
    ...(entry.subject_times ?? []),
  ];
  return subjects.map((s) => (typeof s === "string" ? s : s.name)).filter(Boolean);
}

async function fetchBySearch(title, author) {
  // Open Library search omits the `subject` field by default; have
  // to request it explicitly. Also pull back enough rows to pick
  // the original work — top result is often a film tie-in or
  // adaptation rather than the canonical edition.
  const params = new URLSearchParams({ title });
  if (author) params.append("author", author);
  params.append("limit", "5");
  params.append("fields", "key,title,subject,first_publish_year");
  const url = `https://openlibrary.org/search.json?${params}`;
  const data = await getJson(url);
  const docs = data?.docs ?? [];
  if (docs.length === 0) return [];
  // Prefer the doc with the most subjects (proxy for "the canonical
  // edition has the most metadata"). Tie-break by earliest publish
  // year — adaptations and reprints publish later than originals.
  const ranked = docs
    .map((d) => ({
      subjects: Array.isArray(d.subject) ? d.subject : [],
      year: typeof d.first_publish_year === "number" ? d.first_publish_year : 9999,
    }))
    .sort((a, b) => b.subjects.length - a.subjects.length || a.year - b.year);
  return ranked[0]?.subjects ?? [];
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "ook-backfill (+https://b-ook.vercel.app)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function mapToVocab(subjects, limit) {
  const tagSet = new Set();
  // Apply rules in order; for each subject, check rules and add
  // the FIRST tag that matches.
  for (const subject of subjects) {
    if (typeof subject !== "string") continue;
    const lower = subject.toLowerCase();
    for (const rule of VOCAB) {
      if (rule.match.some((m) => lower.includes(m))) {
        tagSet.add(rule.tag);
        break;
      }
    }
    if (tagSet.size >= limit) break;
  }
  return [...tagSet].slice(0, limit);
}

async function readVault(vaultDir) {
  const dirents = await fs.readdir(vaultDir, { withFileTypes: true });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);
  const out = [];
  for (const slug of slugs) {
    const refPath = path.join(vaultDir, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refPath, "utf8");
    } catch {
      continue;
    }
    const { data } = matter(raw);
    out.push({
      slug,
      path: refPath,
      title: typeof data.title === "string" ? data.title : slug,
      authors: Array.isArray(data.authors) ? data.authors.filter((a) => typeof a === "string") : [],
      isbn13: data.isbn13 ? String(data.isbn13) : null,
      isbn: data.isbn ? String(data.isbn) : null,
      tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [],
    });
  }
  return out;
}

async function writeUpdatedTags(filePath, tags) {
  const raw = await fs.readFile(filePath, "utf8");
  const newLine = `tags: [${tags.join(", ")}]`;
  const tagsRe = /^tags:.*$/m;
  let updated;
  if (tagsRe.test(raw)) {
    updated = raw.replace(tagsRe, newLine);
  } else {
    // `g` flag matters: without it `replace` would fire on the
    // opening `---` and stop without ever reaching the closer.
    const frontmatterClose = /^---\s*$/gm;
    let count = 0;
    updated = raw.replace(frontmatterClose, () => {
      count++;
      return count === 2 ? `${newLine}\n---` : "---";
    });
  }
  await fs.writeFile(filePath, updated, "utf8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
