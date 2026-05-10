#!/usr/bin/env node
// Fetches the top short, high-rating Hardcover reviews for each vault book
// and caches them at `_meta/hardcover-reviews.json` keyed by vault slug.
// The per-book renderer reads the cache at request time to surface a
// "What others said" disclosure with 2–3 quote-worthy snippets.
//
// Designed to run on the operator's machine. The build is offline-clean;
// the cache is the data. Same shape as `backfill-hardcover-books.mjs`.
//
// Auth: requires HARDCOVER_TOKEN in env. JWT (`eyJ…`); pass the bare
// token, the script wraps it in `Bearer …`.
//
// Usage:
//   HARDCOVER_TOKEN=... node scripts/backfill-hardcover-reviews.mjs [--apply]
//                                                                   [--vault PATH]
//                                                                   [--slug SLUG]
//                                                                   [--rate-ms MS]
//                                                                   [--debug]
//                                                                   [--refresh]
//
//   --apply        write _meta/hardcover-reviews.json (default: dry-run)
//   --slug SLUG    only fetch one book; useful for spot-checks
//   --rate-ms MS   request spacing (default 1100ms, under Hardcover's 60/min cap)
//   --debug        print the raw GraphQL response for each book
//   --refresh      ignore the cache and re-fetch every book
//
// Schema notes (Hardcover's Hasura, validated 2026-05-09):
// - Hardcover has NO `book_reviews` root type. Reviews live on `user_books`,
//   one row per (user, book) where the user reviewed the book.
// - Filter fields used: `has_review: { _eq: true }`, `rating: { _gte: 3 }`,
//   `review_length: { _gte: 80, _lte: 600 }`, and the spoiler-safety
//   filter `review_has_spoilers: { _eq: false }`.
// - Sort: `order_by: { likes_count: desc }` — Hardcover's "helpful" analog.
// - Body comes back as HTML (e.g. `<p>...</p>`, `&#39;`). The script
//   strips tags and decodes the common entities client-side so the cache
//   stores plain text.
// - `_ilike` is forbidden by Hardcover's permissions; only `_eq`/`_lte`/
//   `_gte` filters are used here.
//
// Quality-filter defaults:
//   - rating  ≥ 3 (positive-or-mixed; not dunks)
//   - body    80..600 chars (server-filtered via review_length; we want
//             quote-worthy snippets, not full essays)
//   - spoilers excluded
//   - top 3 by likes_count desc
//
// Note: per-book payloads are bigger than the books-meta query, so if you
// see HTTP 429s, bump --rate-ms. Default 1100ms has been fine in spot-checks.

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
const DEBUG = !!argv.debug;
const REFRESH = !!argv.refresh;
const TOKEN = process.env.HARDCOVER_TOKEN;

const ENDPOINT = "https://api.hardcover.app/v1/graphql";
const CACHE_FILE = path.join(VAULT, "_meta", "hardcover-reviews.json");
const HARDCOVER_BOOKS_CACHE = path.join(VAULT, "_meta", "hardcover-books.json");

// Quality-filter defaults — exported via constants so tests can pin them
// and the script header reflects the real numbers.
const MIN_RATING = 3;
const MIN_BODY_LEN = 80;
const MAX_BODY_LEN = 600;
const TOP_N = 3;

// Only run when invoked as a script (node scripts/...). When imported as
// a module — for unit tests of the pure helpers — skip the auto-run so
// we don't blow up on missing HARDCOVER_TOKEN or attempt a real fetch.
const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await main();
}

async function main() {
  if (!TOKEN) {
    process.stderr.write(
      "HARDCOVER_TOKEN is unset. Create a free token at https://hardcover.app/account/api\n",
    );
    process.exit(2);
  }

  const candidates = await readVaultBooks(VAULT);
  const filtered = SLUG_FILTER ? candidates.filter((c) => c.slug === SLUG_FILTER) : candidates;
  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books with hardcover mapping: ${filtered.length}\n`);
  process.stderr.write(
    `mode: ${APPLY ? "APPLY (will write _meta/hardcover-reviews.json)" : "dry-run"}\n\n`,
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

    process.stderr.write(`→ ${c.slug} (hc:${c.hardcoverId})\n`);
    try {
      const raw = await fetchReviews(c.hardcoverId);
      if (DEBUG) {
        process.stderr.write(`  raw: ${JSON.stringify(raw, null, 2)}\n`);
      }
      const transformed = transform(raw, c);
      if (transformed) {
        records[c.slug] = transformed;
        fetched++;
        process.stderr.write(`  ${transformed.reviews.length} reviews kept\n`);
      } else {
        missed++;
        process.stderr.write(`  no qualifying reviews\n`);
      }
    } catch (e) {
      process.stderr.write(`  error: ${e instanceof Error ? e.message : String(e)}\n`);
    }

    await sleep(RATE_MS);
  }

  const next = {
    updated: new Date().toISOString(),
    generator: "scripts/backfill-hardcover-reviews.mjs",
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
    changeNoun: `Hardcover review records → ${CACHE_FILE}`,
    doApply: async () => {
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
      process.stderr.write(`wrote ${CACHE_FILE}\n`);
    },
  });
}

// Walk the vault. Every book that has a `hardcover_id` in its frontmatter
// or a hardcoverId entry in the existing hardcover-books.json cache is a
// candidate. Books without a Hardcover mapping are skipped — there's no
// way to query reviews for them.
async function readVaultBooks(vault) {
  const dirents = await fs.readdir(vault, { withFileTypes: true });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);

  const hcCache = await readExistingCache(HARDCOVER_BOOKS_CACHE);
  const cacheRecords = hcCache.records ?? {};

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

    // Frontmatter wins when present; otherwise look in the books cache by
    // vault slug. The books cache covers every book whose Hardcover
    // lookup has already run, including those without an
    // `hardcover_id` in their frontmatter yet.
    let hcId = null;
    if (typeof data.hardcover_id === "number" && Number.isFinite(data.hardcover_id)) {
      hcId = data.hardcover_id;
    } else if (typeof data.hardcover_id === "string" && /^\d+$/.test(data.hardcover_id)) {
      hcId = Number(data.hardcover_id);
    } else {
      const cached = cacheRecords[slug];
      if (cached && typeof cached.hardcoverId === "number") {
        hcId = cached.hardcoverId;
      }
    }
    if (hcId === null) continue;
    out.push({ slug, hardcoverId: hcId });
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

async function fetchReviews(hardcoverId) {
  const query = /* GraphQL */ `
    query Reviews($bookId: Int!, $minLen: Int!, $maxLen: Int!, $minRating: numeric!, $limit: Int!) {
      books(where: { id: { _eq: $bookId } }, limit: 1) {
        id
        user_books(
          where: {
            has_review: { _eq: true }
            review_has_spoilers: { _eq: false }
            rating: { _gte: $minRating }
            review_length: { _gte: $minLen, _lte: $maxLen }
          }
          order_by: { likes_count: desc }
          limit: $limit
        ) {
          id
          review
          rating
          likes_count
          reviewed_at
          review_has_spoilers
          user {
            id
            username
          }
        }
      }
    }
  `;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "user-agent": "ook/1.0 (+https://github.com/vhata/ook)",
    },
    body: JSON.stringify({
      query,
      variables: {
        bookId: hardcoverId,
        minLen: MIN_BODY_LEN,
        maxLen: MAX_BODY_LEN,
        minRating: MIN_RATING,
        // Pull more than TOP_N so we can re-rank client-side after
        // null-body filtering and length re-check (Hardcover's
        // review_length seems to be raw HTML byte-count for some rows;
        // double-check the cleaned plaintext locally).
        limit: TOP_N * 3,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`HTTP ${res.status} from Hardcover — body: ${body}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

function transform(raw, candidate) {
  const book = raw?.data?.books?.[0];
  if (!book) return null;
  const rows = book.user_books ?? [];
  const reviews = [];
  for (const r of rows) {
    if (typeof r.review !== "string" || r.review.length === 0) continue;
    if (r.review_has_spoilers === true) continue;
    const cleaned = stripHtml(r.review);
    if (cleaned.length < MIN_BODY_LEN) continue;
    if (cleaned.length > MAX_BODY_LEN) continue;
    reviews.push({
      id: typeof r.id === "number" ? String(r.id) : String(r.id ?? ""),
      body: cleaned,
      rating: typeof r.rating === "number" ? r.rating : null,
      username: r.user?.username ?? null,
      likes: typeof r.likes_count === "number" ? r.likes_count : 0,
      createdAt: typeof r.reviewed_at === "string" ? r.reviewed_at : null,
    });
    if (reviews.length >= TOP_N) break;
  }
  if (reviews.length === 0) return null;
  return {
    hardcoverId: candidate.hardcoverId,
    reviews,
  };
}

// Hardcover stores reviews as HTML — strip tags and decode the common
// entities so the cache stores readable plain text. Keeps newlines as
// spaces (the renderer paragraphs them itself if it needs to).
export function stripHtml(html) {
  return html
    .replace(/<\/?(p|br|div|span|i|b|em|strong|u)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply" || a === "--debug" || a === "--refresh") {
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
