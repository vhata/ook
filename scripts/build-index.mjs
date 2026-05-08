#!/usr/bin/env node
// Builds `_index.json` at the root of the vault — a single JSON file
// containing every book's parsed frontmatter plus a per-file
// last-edited date. The runtime reader prefers this index when it
// exists, falling back to walking the vault.
//
// Why: with 232+ books, walking the vault and parsing every reference
// file at request time blows the serverless function timeout. This
// shifts the parse work to build time (prebuild, after the vault
// clone) so each request reads one file instead of ~700.
//
// Runs as part of the `prebuild` chain. Local dev no-ops if the vault
// dir doesn't exist.

import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import matter from "gray-matter";

const execFileAsync = promisify(execFile);

const VAULT = path.resolve(process.env.BOOKS_DIR ?? path.resolve(process.cwd(), ".vault"));
const META_DIR = "_meta";
const VALID_STATUSES = ["tbr", "reading", "finished", "abandoned", "paused"];

await main();

async function main() {
  // Mirror fetch-vault.mjs's gate: in local dev (no deploy key) we
  // don't want to scribble _index.json into the user's actual
  // Obsidian books folder. The fallback walk in books.ts handles the
  // dev case fine.
  if (!process.env.BOOKS_DEPLOY_KEY) {
    process.stderr.write("[build-index] BOOKS_DEPLOY_KEY not set — skipping (local dev mode).\n");
    return;
  }

  let dirents;
  try {
    dirents = await fs.readdir(VAULT, { withFileTypes: true });
  } catch (e) {
    process.stderr.write(`[build-index] vault not readable at ${VAULT}: ${e.message}\n`);
    return;
  }

  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && d.name !== META_DIR && !d.name.startsWith(".") && d.name !== "bin",
    )
    .map((d) => d.name);

  // Build the path → last-edited-date map once via a single git
  // invocation. Same trick the render path uses, except here it's
  // amortised across the whole index build.
  const lastEditedMap = await buildLastEditedMap(VAULT);

  const books = [];
  for (const slug of slugs) {
    const dir = path.join(VAULT, slug);
    const refFile = path.join(dir, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refFile, "utf8");
    } catch {
      continue; // dir without a reference file — skip silently
    }
    const { data } = matter(raw);
    const [hasReview, hasQuotes, hasSummary] = await Promise.all([
      fileExists(path.join(dir, "review.md")),
      fileExists(path.join(dir, "quotes.md")),
      fileExists(path.join(dir, "summary.md")),
    ]);
    const rel = path.relative(VAULT, refFile);
    books.push({
      slug,
      title: typeof data.title === "string" ? data.title : slug,
      authors: parseStringList(data.authors),
      series: parseNullableString(data.series),
      status: parseStatus(data.status),
      progress: typeof data.progress === "string" ? data.progress : "",
      started: parseNullableString(data.started),
      finished: parseNullableString(data.finished),
      rating: parseNullableNumber(data.rating),
      wouldReread: typeof data.would_reread === "boolean" ? data.would_reread : null,
      bingoSquares: parseStringList(data.bingo_squares),
      tags: parseStringList(data.tags),
      cover: parseNullableString(data.cover),
      pullquote: parsePullquote(data.pullquote),
      seeAlso: parseStringList(data.see_also),
      lastEdited: lastEditedMap.get(rel) ?? null,
      hasReview,
      hasQuotes,
      hasSummary,
      goodreadsId: parseId(data.goodreads_id),
      hardcoverSlug: parseNullableString(data.hardcover_slug),
      storygraphSlug: parseNullableString(data.storygraph_slug),
      bookwyrmUrl: parseNullableString(data.bookwyrm_url),
      source:
        data.source === "goodreads" || data.source === "media-list" || data.source === "manual"
          ? data.source
          : null,
    });
  }

  const indexPath = path.join(VAULT, "_index.json");
  await fs.writeFile(indexPath, JSON.stringify({ books, builtAt: new Date().toISOString() }));
  process.stderr.write(`[build-index] wrote ${books.length} books → ${indexPath}\n`);
}

async function buildLastEditedMap(repoDir) {
  const map = new Map();
  try {
    const { stdout } = await execFileAsync("git", ["log", "--name-only", "--pretty=format:%cs"], {
      cwd: repoDir,
      maxBuffer: 64 * 1024 * 1024,
    });
    let currentDate = null;
    for (const rawLine of stdout.split("\n")) {
      if (!rawLine) continue;
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawLine)) {
        currentDate = rawLine;
        continue;
      }
      if (currentDate && !map.has(rawLine)) map.set(rawLine, currentDate);
    }
  } catch {
    // not a git repo — empty map; lastEdited will be null everywhere.
  }
  return map;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function parseStatus(value) {
  if (typeof value === "string" && VALID_STATUSES.includes(value)) return value;
  return "tbr";
}

function parseStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string");
}

function parseNullableString(value) {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function parseNullableNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function parseId(value) {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parsePullquote(value) {
  if (!value || typeof value !== "object") return null;
  const text = typeof value.text === "string" ? value.text : null;
  if (!text) return null;
  return { text, source: typeof value.source === "string" ? value.source : null };
}
