#!/usr/bin/env node
// Backfills the `source` frontmatter field on every book in the vault
// based on what evidence we can glean from the existing file:
//
//   - Body contains "Imported from Goodreads" → source: goodreads
//   - Body contains "Imported from Media List" → source: media-list
//   - Has a `goodreads_id` field → source: goodreads (manually-maintained
//     books that nonetheless link to Goodreads)
//   - Otherwise → source: manual
//
// `source` distinguishes books with personal reading history (Goodreads
// imports — the user has rated and dated these) from word-of-mouth
// recommendations (Media List). The in-vault agent uses it to drive
// periodic check-ins: "you imported X from Goodreads but it has no
// finished date — when did you read it?"
//
// Idempotent: skips books that already have a `source` line. Default
// dry-run; --apply rewrites the frontmatter.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;

await main();

async function main() {
  const dirents = await fs.readdir(VAULT, { withFileTypes: true });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${slugs.length}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const counts = { goodreads: 0, "media-list": 0, manual: 0, skipped: 0 };
  for (const slug of slugs) {
    const refPath = path.join(VAULT, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refPath, "utf8");
    } catch {
      continue;
    }
    const { data, content } = matter(raw);

    // Skip books that already declare a source — backfill is one-shot.
    if (typeof data.source === "string" && data.source.length > 0) {
      counts.skipped++;
      continue;
    }

    const source = inferSource(data, content);
    counts[source]++;
    process.stdout.write(`${slug.padEnd(48)} → ${source}\n`);

    if (APPLY) {
      await writeUpdatedSource(refPath, source);
    }
  }

  process.stderr.write(
    `\ngoodreads: ${counts.goodreads} · media-list: ${counts["media-list"]} · ` +
      `manual: ${counts.manual} · already-set: ${counts.skipped}\n`,
  );
  if (!APPLY) process.stderr.write("(dry-run; rerun with --apply to write)\n");
}

function inferSource(data, content) {
  // Body-text marker wins (most explicit signal — the import scripts
  // wrote these themselves).
  if (/Imported from Goodreads/i.test(content)) return "goodreads";
  if (/Imported from Media List/i.test(content)) return "media-list";

  // Has a goodreads_id but no body marker → manually-maintained book
  // that the user linked to Goodreads. Treat as source: goodreads
  // because the user clearly intended Goodreads as the canonical link.
  if (data.goodreads_id !== undefined && data.goodreads_id !== null) return "goodreads";

  // Default — hand-built by the user.
  return "manual";
}

async function writeUpdatedSource(filePath, source) {
  const raw = await fs.readFile(filePath, "utf8");
  const newLine = `source: ${source}`;
  const sourceRe = /^source:.*$/m;
  if (sourceRe.test(raw)) {
    await fs.writeFile(filePath, raw.replace(sourceRe, newLine), "utf8");
    return;
  }
  // Append before the closing `---` of the frontmatter. The `g` flag
  // is critical here — without it, `replace` would fire on the opener
  // (count=1) and stop without ever reaching the closer.
  const close = /^---\s*$/gm;
  let count = 0;
  const updated = raw.replace(close, () => {
    count++;
    return count === 2 ? `${newLine}\n---` : "---";
  });
  await fs.writeFile(filePath, updated, "utf8");
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
