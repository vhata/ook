#!/usr/bin/env node
// Fetch community-curated quotes from Wikiquote for each finished
// book in the vault. Cache to `_meta/wikiquotes.json` keyed by vault
// slug. Operator-run only; the public site never renders these
// directly — the `/admin/community-quotes` review page surfaces them
// for the operator to (optionally) copy into their own pullquote or
// quotes.md by hand. Honours the "no third-party quotes on the public
// site without owner approval" constraint.
//
// MediaWiki API: https://en.wikiquote.org/w/api.php
//   action=parse&page=<Title>&format=json&prop=wikitext
// Returns the raw wikitext of the page. We extract the `== Quotes ==`
// section, pull `*`-prefixed lines as quotes, and attach following
// `**`-prefixed lines as attribution. {{Cite ...}} and other templates
// are stripped during extraction.
//
// Title-variant fallback: many books resolve on Wikiquote under
// `<Title>`, `<Title> (novel)`, or `<Title> (Author)`. We try each
// variant in priority order until one returns a non-empty quote
// section.
//
// Rate-limited at ≥ 1100 ms per request — Wikiquote is generous but
// being polite costs nothing. Default dry-run; --apply writes the
// cache. Idempotent: re-running on a vault with an existing cache
// skips books already in the cache unless --refresh is passed.
//
// Usage:
//   node scripts/backfill-wikiquotes.mjs [--vault PATH] [--apply]
//                                        [--slug SLUG] [--rate-ms MS]
//                                        [--refresh]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const SLUG_FILTER = argv.slug ?? null;
const RATE_MS = Number(argv["rate-ms"] ?? 1100);
const REFRESH = !!argv.refresh;
const CACHE_FILE = path.join(VAULT, "_meta", "wikiquotes.json");

const ENDPOINT = "https://en.wikiquote.org/w/api.php";
const USER_AGENT = "ook/1.0 (+https://github.com/vhata/ook)";

const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await main();
}

async function main() {
  const candidates = await readFinishedBooks(VAULT);
  const filtered = SLUG_FILTER ? candidates.filter((c) => c.slug === SLUG_FILTER) : candidates;

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`finished books: ${filtered.length}\n`);
  process.stderr.write(
    `mode: ${APPLY ? "APPLY (will write _meta/wikiquotes.json)" : "dry-run"}\n\n`,
  );

  const existing = await readExistingCache(CACHE_FILE);
  const records = REFRESH ? {} : { ...(existing.records ?? {}) };
  let fetched = 0;
  let skipped = 0;
  let missed = 0;

  for (const c of filtered) {
    if (records[c.slug] && !REFRESH && !SLUG_FILTER) {
      skipped++;
      continue;
    }

    process.stderr.write(`→ ${c.slug} (${c.title})\n`);
    let landed = false;
    for (const variant of titleVariants(c.title, c.authors)) {
      try {
        const wikitext = await fetchWikitext(variant);
        if (!wikitext) continue;
        const quotes = extractQuotes(wikitext);
        if (quotes.length === 0) continue;
        records[c.slug] = {
          variant,
          fetchedAt: new Date().toISOString(),
          quotes: quotes.slice(0, 10), // cap to keep the cache lean
        };
        process.stderr.write(
          `  ✓ ${quotes.length} quote${quotes.length === 1 ? "" : "s"} via "${variant}"\n`,
        );
        fetched++;
        landed = true;
        break;
      } catch (e) {
        process.stderr.write(
          `  error on "${variant}": ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    }
    if (!landed) {
      missed++;
      process.stderr.write(`  no Wikiquote match\n`);
    }

    await sleep(RATE_MS);
  }

  const next = {
    updated: new Date().toISOString(),
    generator: "scripts/backfill-wikiquotes.mjs",
    records,
  };

  if (!APPLY) {
    process.stdout.write(JSON.stringify(next, null, 2) + "\n");
  }
  process.stderr.write(
    `\nfetched: ${fetched}, skipped (already cached): ${skipped}, no-match: ${missed}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: fetched,
    changeNoun: `Wikiquote records → ${CACHE_FILE}`,
    doApply: async () => {
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
      process.stderr.write(`wrote ${CACHE_FILE}\n`);
    },
  });
}

// Finished books with a title; the only filter Wikiquote needs.
async function readFinishedBooks(vault) {
  const dirents = await fs.readdir(vault, { withFileTypes: true });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);
  const out = [];
  for (const slug of slugs) {
    const refPath = path.join(vault, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refPath, "utf8");
    } catch {
      continue;
    }
    const { data } = matter(raw);
    if (data.status !== "finished") continue;
    if (typeof data.title !== "string") continue;
    const authors = Array.isArray(data.authors)
      ? data.authors.filter((a) => typeof a === "string")
      : [];
    out.push({ slug, title: data.title, authors });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function readExistingCache(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Title-variant generation. Many books resolve under one of a few
// canonical Wikiquote page names. Try the bare title first, then
// disambiguator-suffixed variants in priority order.
//
// Exported for unit tests.
export function titleVariants(title, authors) {
  const variants = [title];
  variants.push(`${title} (novel)`);
  variants.push(`${title} (book)`);
  if (authors.length > 0) {
    const firstAuthor = authors[0];
    // "<Title> (<Author>)"
    variants.push(`${title} (${firstAuthor})`);
    // Surname-only suffix — used when first author's name is a
    // multi-word string with a last name distinguishable from the
    // title's words.
    const surname = firstAuthor.split(/\s+/).pop();
    if (surname && surname.length > 1) variants.push(`${title} (${surname})`);
  }
  // De-dupe while preserving order.
  return Array.from(new Set(variants));
}

async function fetchWikitext(title) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", title);
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("formatversion", "2");
  const res = await fetch(url.toString(), {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`HTTP ${res.status} from Wikiquote`);
  }
  const json = await res.json();
  if (json.error) return null; // missing page or similar
  const wikitext = json?.parse?.wikitext;
  if (typeof wikitext !== "string") return null;
  return wikitext;
}

// Pure: given a Wikiquote page's raw wikitext, pull quote bullets out
// of the `== Quotes ==` section. Each quote is the text after the
// leading `* `; any nested `** ` lines following it become the
// attribution. Templates ({{...}}), wiki links ([[Target|Text]] →
// "Text"), and bold/italic markup are stripped.
//
// Returns an array of `{ text, source }` in source order. Caller
// caps the count.
//
// Exported for unit tests.
export function extractQuotes(wikitext) {
  if (typeof wikitext !== "string" || wikitext.length === 0) return [];

  // Find the Quotes section. Section heading shapes:
  //   == Quotes ==        (the canonical case)
  //   == Selected quotes ==
  //   == Quotations ==
  const sectionRe = /^==\s*(?:Quotes|Quotations|Selected[\s]+quotes)\s*==\s*$/im;
  const start = wikitext.search(sectionRe);
  if (start === -1) return [];
  // Slice from the line AFTER the heading.
  const afterHeading = wikitext.slice(start).replace(sectionRe, "").trimStart();
  // Stop at the next section heading of the same level (== ... ==).
  const stopRe = /^==[^=]/m;
  const stop = afterHeading.search(stopRe);
  const body = stop === -1 ? afterHeading : afterHeading.slice(0, stop);

  const lines = body.split("\n");
  const out = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const quoteMatch = /^\*\s+(.+)$/.exec(line);
    if (quoteMatch && !line.startsWith("**")) {
      const text = cleanWikitext(quoteMatch[1]);
      if (text.length === 0) continue;
      out.push({ text, source: null });
      continue;
    }
    const attrMatch = /^\*\*\s+(.+)$/.exec(line);
    if (attrMatch && out.length > 0) {
      const last = out[out.length - 1];
      const cleaned = cleanWikitext(attrMatch[1]);
      if (cleaned.length > 0) {
        last.source = last.source ? `${last.source}; ${cleaned}` : cleaned;
      }
    }
  }
  return out;
}

// Strip the common wikitext decorations: `{{template|args}}` → empty,
// `[[Target|Text]]` → Text, `[[Target]]` → Target, `'''bold'''` →
// bold, `''italic''` → italic, `<ref>...</ref>` → empty, HTML tags →
// empty. The result is plain prose suitable for rendering.
//
// Exported for unit tests.
export function cleanWikitext(s) {
  let out = s;
  // Templates {{...}} (non-greedy, but support nesting via a loop)
  for (let i = 0; i < 8; i++) {
    const before = out;
    out = out.replace(/\{\{[^{}]*\}\}/g, "");
    if (out === before) break;
  }
  // Refs <ref>...</ref> and self-closing <ref />.
  out = out.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  // Wiki links [[A|B]] → B, [[A]] → A.
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1");
  // Bold / italic.
  out = out.replace(/'''([^']+)'''/g, "$1").replace(/''([^']+)''/g, "$1");
  // Any remaining HTML tags.
  out = out.replace(/<[^>]+>/g, "");
  // Collapse runs of whitespace.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--refresh") out.refresh = true;
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
