#!/usr/bin/env node
// Fetches the full member list for each series the vault knows about,
// from Hardcover's GraphQL API, and writes the result to
// `_meta/series-rosters.json`. The /series renderer reads that file
// at build/request time to surface missing-from-vault entries with
// their canonical title + author, instead of just the integer-gap
// placeholders the corpus alone can detect.
//
// Designed to run on the operator's machine — internet-touching by
// nature — and committed to the books vault. Build is offline-clean;
// the cache is the data.
//
// Auth: requires HARDCOVER_TOKEN in env. Free tier; create a token
// at https://hardcover.app/account/api after signing up. The token is
// sent as `Authorization: Bearer <token>`.
//
// Usage:
//   HARDCOVER_TOKEN=... node scripts/backfill-series-rosters.mjs [--apply]
//                                                                 [--vault PATH]
//                                                                 [--series NAME]
//                                                                 [--rate-ms MS]
//                                                                 [--debug]
//
//   --apply        write _meta/series-rosters.json (default: dry-run; print to stdout)
//   --series NAME  only fetch one series; useful for testing the query shape
//   --rate-ms MS   request spacing (default 1100ms ≈ 55/min, under Hardcover's 60/min cap)
//   --debug        print the raw GraphQL response for each series
//
// IMPORTANT — this script's GraphQL query was not live-tested by the
// agent that wrote it (no network access at write time). Run with
// --series=<one-of-yours> --debug first; if the response shape isn't
// `data.series[0].series_books[].book.{title,slug,contributions[].author.name}`
// (the assumed Hasura/Hardcover convention), adjust the query around
// the marked block in `fetchRoster()` to match what Hardcover actually
// returns. The transformation logic in `transformRoster()` is the
// only other thing that depends on the response shape.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const SERIES_FILTER = argv.series ?? null;
const RATE_MS = Number(argv["rate-ms"] ?? 1100);
const DEBUG = !!argv.debug;
const TOKEN = process.env.HARDCOVER_TOKEN;

const ENDPOINT = "https://api.hardcover.app/v1/graphql";
const ROSTER_FILE = path.join(VAULT, "_meta", "series-rosters.json");

await main();

async function main() {
  if (!TOKEN) {
    process.stderr.write(
      "HARDCOVER_TOKEN is unset. Create a free token at https://hardcover.app/account/api\n",
    );
    process.exit(2);
  }

  const seriesNames = SERIES_FILTER ? [SERIES_FILTER] : await readSeriesNames(VAULT);
  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`series to fetch: ${seriesNames.length}\n`);
  process.stderr.write(
    `mode: ${APPLY ? "APPLY (will write _meta/series-rosters.json)" : "dry-run"}\n\n`,
  );

  const existing = await readExistingRosters(ROSTER_FILE);
  const rosters = { ...(existing.rosters ?? {}) };
  let fetched = 0;
  let skipped = 0;

  for (const name of seriesNames) {
    if (rosters[name] && !SERIES_FILTER) {
      // Skip series we already have a cache for unless --series targets it
      // explicitly. Refresh the whole cache by deleting the file first.
      skipped++;
      continue;
    }

    process.stderr.write(`→ ${name}\n`);
    try {
      const raw = await fetchRoster(name);
      if (DEBUG) {
        process.stderr.write(`  raw response: ${JSON.stringify(raw, null, 2)}\n`);
      }
      const transformed = transformRoster(raw, name);
      if (transformed) {
        rosters[name] = transformed;
        fetched++;
        process.stderr.write(`  ${transformed.books.length} books\n`);
      } else {
        process.stderr.write(`  no match found\n`);
      }
    } catch (e) {
      process.stderr.write(`  error: ${e instanceof Error ? e.message : String(e)}\n`);
    }

    await sleep(RATE_MS);
  }

  const next = {
    updated: new Date().toISOString(),
    generator: "scripts/backfill-series-rosters.mjs",
    rosters,
  };

  if (APPLY) {
    await fs.mkdir(path.dirname(ROSTER_FILE), { recursive: true });
    await fs.writeFile(ROSTER_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
    process.stderr.write(`\nwrote ${ROSTER_FILE}\n`);
  } else {
    process.stdout.write(JSON.stringify(next, null, 2) + "\n");
    process.stderr.write(`\n(dry-run; rerun with --apply to write)\n`);
  }
  process.stderr.write(`fetched: ${fetched}, skipped (already cached): ${skipped}\n`);
}

async function readSeriesNames(vault) {
  const dirents = await fs.readdir(vault, { withFileTypes: true });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);
  const names = new Set();
  for (const slug of slugs) {
    const refPath = path.join(vault, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refPath, "utf8");
    } catch {
      continue;
    }
    const { data } = matter(raw);
    const series = typeof data.series === "string" ? data.series : null;
    if (!series) continue;
    // Same parser as src/lib/books.ts:parseSeriesMemberships — handle
    // multi-series strings ("Discworld, #32; Tiffany Aching #2") so
    // each membership becomes a fetched series.
    for (const segment of series.split(";")) {
      const cleaned = segment.replace(/^\s*,?\s*|\s*,?\s*$/g, "");
      if (cleaned.length === 0) continue;
      const m = /^(.+?)\s*,?\s*#\d+(?:\.\d+)?\s*$/.exec(cleaned);
      const name = m ? m[1].replace(/\s*,\s*$/, "").trim() : cleaned;
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

async function readExistingRosters(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ────────────────────────────────────────────────────────────────────
// Hardcover query — the part most likely to need adjustment if the
// schema differs from what's documented elsewhere.
async function fetchRoster(name) {
  const query = /* GraphQL */ `
    query SeriesByName($name: String!) {
      series(where: { name: { _ilike: $name } }, limit: 1) {
        id
        name
        slug
        books_count
        series_books(order_by: { position: asc }) {
          position
          book {
            title
            slug
            contributions(limit: 1) {
              author {
                name
              }
            }
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
    },
    body: JSON.stringify({ query, variables: { name } }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from Hardcover`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

function transformRoster(raw, queriedName) {
  const series = raw?.data?.series?.[0];
  if (!series) return null;
  const books = (series.series_books ?? []).map((sb) => ({
    position: sb.position ?? null,
    title: sb.book?.title ?? null,
    slug: sb.book?.slug ?? null,
    authors: (sb.book?.contributions ?? [])
      .map((c) => c.author?.name)
      .filter((n) => typeof n === "string"),
  }));
  return {
    queriedName,
    name: series.name ?? queriedName,
    hardcoverSlug: series.slug ?? null,
    count: series.books_count ?? books.length,
    books,
  };
}
// ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply" || a === "--debug") {
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
