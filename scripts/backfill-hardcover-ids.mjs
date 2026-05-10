#!/usr/bin/env node
// Backfills `hardcover_slug` and `hardcover_id` frontmatter on every
// vault book that doesn't already have them, from the existing
// `_meta/hardcover-books.json` cache (populated by
// `scripts/backfill-hardcover-books.mjs`).
//
// Why: the Hardcover lookup has already happened — the cache holds
// `hardcoverId` and `hardcoverSlug` keyed by vault slug. Without those
// values in frontmatter, the renderer's outbound external-link row
// (`externalLinks()` in `src/lib/books.ts`) skips the Hardcover entry
// for every book the user hasn't manually annotated. This script
// closes the loop: read the cache, write the matched slug + id into
// each book's frontmatter.
//
// Idempotent: re-running on a vault that's already been backfilled
// produces zero writes. A book with `hardcover_slug` already set keeps
// it; the script only ADDS the missing field(s). Default dry-run;
// --apply rewrites the frontmatter. When stdin is a TTY and there are
// pending changes, the script prompts at the end of the dry-run
// summary asking whether to apply — so the work the dry-run just did
// isn't thrown away. Non-TTY stdin (CI, pipes) never prompts.
//
// Dry-run output is shaped as a unified diff — `→ <slug>` per book,
// then green `+ hardcover_slug: …` and/or `+ hardcover_id: …` lines
// showing the field(s) that would be inserted. ANSI colour only when
// stdout is a TTY; piped output stays plain.
//
// Usage:
//   node scripts/backfill-hardcover-ids.mjs [--vault PATH] [--apply]

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { formatBookHeader, formatLineInsertion } from "./lib/diff-format.mjs";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const CACHE_FILE = path.join(VAULT, "_meta", "hardcover-books.json");

await main();

async function main() {
  const cache = await readCache(CACHE_FILE);
  if (!cache) {
    process.stderr.write(
      `no Hardcover cache at ${CACHE_FILE}\n` +
        `run \`make vault-hardcover-books\` (and apply when prompted) first to populate it.\n`,
    );
    process.exit(2);
  }

  const dirents = await fs.readdir(VAULT, { withFileTypes: true });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${slugs.length}\n`);
  process.stderr.write(`cache records: ${Object.keys(cache).length}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const counts = {
    bothWritten: 0,
    slugOnly: 0,
    idOnly: 0,
    alreadySet: 0,
    noCache: 0,
    cacheEmpty: 0,
  };
  // Pending writes collected during the dry-run pass — fired by
  // `maybePromptApply` at the end so the work isn't thrown away.
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

    const haveSlug = typeof data.hardcover_slug === "string" && data.hardcover_slug.length > 0;
    const haveId = typeof data.hardcover_id === "number" && Number.isFinite(data.hardcover_id);

    if (haveSlug && haveId) {
      counts.alreadySet++;
      continue;
    }

    const record = cache[slug];
    if (!record) {
      counts.noCache++;
      continue;
    }

    const newSlug =
      !haveSlug && typeof record.hardcoverSlug === "string" && record.hardcoverSlug
        ? record.hardcoverSlug
        : null;
    const newId =
      !haveId && typeof record.hardcoverId === "number" && Number.isFinite(record.hardcoverId)
        ? record.hardcoverId
        : null;

    if (newSlug === null && newId === null) {
      // Cache entry exists but doesn't carry the bits we need (or the
      // book already has them). No work to do.
      counts.cacheEmpty++;
      continue;
    }

    if (newSlug !== null && newId !== null) counts.bothWritten++;
    else if (newSlug !== null) counts.slugOnly++;
    else counts.idOnly++;

    const writes = [];
    if (newSlug !== null) writes.push(["hardcover_slug", newSlug]);
    if (newId !== null) writes.push(["hardcover_id", newId]);

    process.stdout.write(`${formatBookHeader(slug)}\n`);
    for (const [k, v] of writes) {
      process.stdout.write(`${formatLineInsertion(`${k}: ${v}`)}\n`);
    }
    pending.push(() => writeFields(refPath, writes));
  }

  process.stderr.write(
    `\nboth: ${counts.bothWritten} · slug-only: ${counts.slugOnly} · ` +
      `id-only: ${counts.idOnly} · already-set: ${counts.alreadySet} · ` +
      `no cache record: ${counts.noCache} · cache empty: ${counts.cacheEmpty}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "Hardcover-id frontmatter updates",
    doApply: async () => {
      for (const write of pending) await write();
      process.stderr.write(`wrote ${pending.length} books\n`);
    },
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

// Surgical line-level frontmatter edit — same shape as
// `backfill-source.mjs`. We do NOT round-trip through gray-matter
// stringify; that re-serialises the whole block and clobbers
// unrelated whitespace / quote-style. For each new field, prefer
// inserting after a sensible neighbour (`goodreads_id` for the
// hardcover pair, then `hardcover_slug` for the id) so the resulting
// order reads naturally; fall back to inserting before the closing
// `---` of the frontmatter block.
//
// `writes` is an ordered list of `[key, value]` pairs. Values get
// rendered as bare YAML — slugs are `[a-z0-9-]+` so unquoted is safe,
// and ids are integers. No quoting needed for either.
async function writeFields(filePath, writes) {
  let raw = await fs.readFile(filePath, "utf8");
  for (const [key, value] of writes) {
    raw = insertField(raw, key, value);
  }
  await fs.writeFile(filePath, raw, "utf8");
}

function insertField(raw, key, value) {
  const newLine = `${key}: ${value}`;
  const existingRe = new RegExp(`^${escapeRe(key)}:.*$`, "m");
  if (existingRe.test(raw)) {
    // Caller should have filtered these out, but belt-and-braces:
    // never blindly overwrite an existing value.
    return raw;
  }

  // Try anchors in priority order. First match wins.
  const anchors =
    key === "hardcover_id"
      ? ["hardcover_slug", "goodreads_id"]
      : key === "hardcover_slug"
        ? ["goodreads_id", "isbn13", "isbn"]
        : [];

  for (const anchor of anchors) {
    const anchorRe = new RegExp(`^(${escapeRe(anchor)}:.*)$`, "m");
    const m = raw.match(anchorRe);
    if (m) {
      return raw.replace(anchorRe, `$1\n${newLine}`);
    }
  }

  // Fall back to inserting before the closing `---`. The `g` flag is
  // critical here — without it `replace` would fire on the opener
  // (count=1) and stop without ever reaching the closer.
  const close = /^---\s*$/gm;
  let count = 0;
  return raw.replace(close, () => {
    count++;
    return count === 2 ? `${newLine}\n---` : "---";
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
