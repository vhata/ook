#!/usr/bin/env node
// Demotes vault books from `status: reading` to `status: paused` when
// their last progress is older than the threshold (default 90 days,
// matching `PAUSE_DAYS` in src/lib/status.ts so this script and the
// render-time auto-promote agree).
//
// Why: the home page and `/now` already auto-promote stale reading
// books to paused at render time via `effectiveStatus()`, so a
// book flipped to reading in 2017 and never closed out reads
// correctly as "Set aside." But the underlying frontmatter still
// says `status: reading`, which is honest-to-the-data wrong. This
// script flushes the render's view back into the data.
//
// Threshold uses `last_progress` when present, falling back to
// `started` when it's not — same shape as the runtime helper.
// Books with neither anchor get paused too (no evidence of activity
// at all — set them aside in the data).
//
// Pure vault-to-frontmatter: no network, no Kindle cache, no APIs.
// Default dry-run; --apply writes. Prompts when stdin is a TTY via
// scripts/lib/maybe-prompt-apply.mjs. Per-book skip: never touches a
// book whose status isn't already `reading`.
//
// Usage:
//   node scripts/pause-stale-reading.mjs [--vault PATH] [--apply]
//                                         [--threshold-days N]
//                                         [--slug SLUG]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { formatBookHeader, formatLineChange } from "./lib/diff-format.mjs";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";

const DEFAULT_THRESHOLD_DAYS = 90;
const DAY_MS = 86400000;

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const SLUG_FILTER = argv.slug ?? null;
const THRESHOLD_DAYS = Number(argv["threshold-days"] ?? DEFAULT_THRESHOLD_DAYS);
if (!Number.isFinite(THRESHOLD_DAYS) || THRESHOLD_DAYS < 0) {
  process.stderr.write(`invalid --threshold-days: ${argv["threshold-days"]}\n`);
  process.exit(2);
}

const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await main();
}

async function main() {
  const dirents = await fs.readdir(VAULT, { withFileTypes: true });
  let slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name)
    .sort();
  if (SLUG_FILTER) slugs = slugs.filter((s) => s === SLUG_FILTER);

  const today = new Date();
  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${slugs.length}\n`);
  process.stderr.write(`threshold: ${THRESHOLD_DAYS} days since last_progress / started\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const counts = {
    paused: 0,
    activeReading: 0,
    notReading: 0,
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

    if (data.status !== "reading") {
      counts.notReading++;
      continue;
    }

    const anchor = stringOrNull(data.last_progress) ?? stringOrNull(data.started);
    const daysSince = anchor ? daysBetween(anchor, today) : null;
    const isStale = daysSince === null || daysSince > THRESHOLD_DAYS;

    if (!isStale) {
      counts.activeReading++;
      continue;
    }

    counts.paused++;
    const sinceLabel = daysSince === null ? "no anchor" : `${daysSince} days since ${anchor}`;
    process.stdout.write(`${formatBookHeader(slug)}  (${sinceLabel})\n`);
    process.stdout.write(`${formatLineChange("status: reading", "status: paused")}\n`);
    pending.push(() => rewriteStatus(refPath));
  }

  process.stderr.write(
    `\nwould pause: ${counts.paused} · still active: ${counts.activeReading} · ` +
      `not reading: ${counts.notReading}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "stale-reading → paused frontmatter updates",
    doApply: async () => {
      for (const write of pending) await write();
      process.stderr.write(`wrote ${pending.length} books\n`);
    },
  });
}

async function rewriteStatus(filePath) {
  let raw = await fs.readFile(filePath, "utf8");
  raw = pausesReadingStatus(raw);
  await fs.writeFile(filePath, raw, "utf8");
}

// Surgical line-level edit. Replaces the FIRST `status: reading` line
// in the file with `status: paused`, leaving everything else intact.
// Refuses to act when no `status: reading` line is present.
export function pausesReadingStatus(raw) {
  const match = /^status:\s*reading\s*$/m;
  if (!match.test(raw)) return raw;
  return raw.replace(match, "status: paused");
}

function stringOrNull(value) {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

// Whole-day difference between a YYYY-MM-DD anchor and today (UTC).
// Negative diffs (anchor in the future) clamp to 0 so a fresh-future
// anchor doesn't accidentally count as stale.
function daysBetween(anchor, today) {
  const anchorMs = Date.parse(`${anchor}T00:00:00Z`);
  if (!Number.isFinite(anchorMs)) return null;
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((todayMs - anchorMs) / DAY_MS));
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
