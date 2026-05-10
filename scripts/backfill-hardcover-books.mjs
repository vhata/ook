#!/usr/bin/env node
// Looks up each vault book on Hardcover (by goodreads_id) and caches the
// canonical metadata — rating, ratings_count, reviews_count, users_count,
// pages, release_year — keyed by vault slug. Writes the result to
// `_meta/hardcover-books.json` for the per-book renderer to consume.
//
// Designed to run on the operator's machine. The build is offline-clean;
// the cache is the data. Same shape as `backfill-series-rosters.mjs`.
//
// Auth: requires HARDCOVER_TOKEN in env. JWT (`eyJ…`); pass the bare
// token, the script wraps it in `Bearer …`.
//
// Usage:
//   HARDCOVER_TOKEN=... node scripts/backfill-hardcover-books.mjs [--apply]
//                                                                  [--vault PATH]
//                                                                  [--slug SLUG]
//                                                                  [--rate-ms MS]
//                                                                  [--debug]
//                                                                  [--refresh]
//
//   --apply        write _meta/hardcover-books.json (default: dry-run)
//   --slug SLUG    only fetch one book; useful for spot-checks
//   --rate-ms MS   request spacing (default 1100ms, under Hardcover's 60/min cap)
//   --debug        print the raw GraphQL response for each book
//   --refresh      ignore the cache and re-fetch every book

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

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
const CACHE_FILE = path.join(VAULT, "_meta", "hardcover-books.json");
const GOODREADS_PLATFORM_ID = 1;

await main();

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
  process.stderr.write(`books with goodreads_id: ${filtered.length}\n`);
  process.stderr.write(
    `mode: ${APPLY ? "APPLY (will write _meta/hardcover-books.json)" : "dry-run"}\n\n`,
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

    process.stderr.write(`→ ${c.slug} (gr:${c.goodreadsId})\n`);
    try {
      const raw = await fetchByGoodreads(c.goodreadsId);
      if (DEBUG) {
        process.stderr.write(`  raw: ${JSON.stringify(raw, null, 2)}\n`);
      }
      const transformed = transform(raw, c);
      if (transformed) {
        records[c.slug] = transformed;
        fetched++;
        process.stderr.write(
          `  ★ ${transformed.rating?.toFixed(2) ?? "—"} (${transformed.ratings_count} ratings, ${transformed.users_count} readers)\n`,
        );
      } else {
        missed++;
        process.stderr.write(`  no Hardcover record for goodreads:${c.goodreadsId}\n`);
      }
    } catch (e) {
      process.stderr.write(`  error: ${e instanceof Error ? e.message : String(e)}\n`);
    }

    await sleep(RATE_MS);
  }

  const next = {
    updated: new Date().toISOString(),
    generator: "scripts/backfill-hardcover-books.mjs",
    records,
  };

  if (APPLY) {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
    process.stderr.write(`\nwrote ${CACHE_FILE}\n`);
  } else {
    process.stdout.write(JSON.stringify(next, null, 2) + "\n");
    process.stderr.write(`\n(dry-run; rerun with --apply to write)\n`);
  }
  process.stderr.write(
    `fetched: ${fetched}, skipped (already cached): ${skipped}, no-match: ${missed}\n`,
  );
}

async function readVaultBooks(vault) {
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
    const gid = data.goodreads_id;
    if (gid === null || gid === undefined || gid === "") continue;
    out.push({ slug, goodreadsId: String(gid) });
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

async function fetchByGoodreads(goodreadsId) {
  const query = /* GraphQL */ `
    query BookByGoodreads($gid: String!, $platform: Int!) {
      book_mappings(
        where: { platform_id: { _eq: $platform }, external_id: { _eq: $gid } }
        limit: 1
      ) {
        book {
          id
          title
          slug
          pages
          rating
          ratings_count
          reviews_count
          users_count
          users_read_count
          release_year
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
      variables: { gid: goodreadsId, platform: GOODREADS_PLATFORM_ID },
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
  const book = raw?.data?.book_mappings?.[0]?.book;
  if (!book) return null;
  return {
    goodreadsId: candidate.goodreadsId,
    hardcoverId: book.id ?? null,
    hardcoverSlug: book.slug ?? null,
    title: book.title ?? null,
    pages: book.pages ?? null,
    rating: book.rating ?? null,
    ratings_count: book.ratings_count ?? 0,
    reviews_count: book.reviews_count ?? 0,
    users_count: book.users_count ?? 0,
    users_read_count: book.users_read_count ?? 0,
    release_year: book.release_year ?? null,
  };
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
