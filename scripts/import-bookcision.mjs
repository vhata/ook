#!/usr/bin/env node
// One-shot importer for a Bookcision JSON export. The Bookcision
// bookmarklet (https://github.com/TristanH/bookcision) is a once-per-
// book manual flow on the operator's side: open the Kindle web reader
// for a finished book, hit the bookmarklet, hit "Download as JSON".
// Drop the resulting file into the book's vault directory (or anywhere
// the operator likes), then run this importer.
//
// Two invocation modes:
//
//   node scripts/import-bookcision.mjs <path-to-bookcision.json> [--apply]
//   node scripts/import-bookcision.mjs --dir <directory>          [--apply]
//
// In both modes the importer:
//
//   1. Parses each file as Bookcision JSON (`{ asin, title, authors,
//      highlights[] }` — see scripts/lib/bookcision.mjs for the full
//      schema reference).
//   2. Joins the payload to a vault directory via ASIN first
//      (frontmatter `amazon_asin:`), falling back to fuzzy title match
//      against the vault's `title:` frontmatter — same shape as
//      scripts/backfill-asin-from-sessions.mjs.
//   3. Appends the highlights into the matched book's `quotes.md` under
//      a `## From Kindle highlights` heading. Per-entry HTML-comment
//      dedupe hashes mean a re-run with the same JSON is a no-op.
//   4. Tracks per-file state in `<vault>/_meta/bookcision-state.json`
//      so the operator can re-run the script over a directory without
//      re-reading files whose contents haven't changed since last pass.
//
// Default dry-run; `--apply` writes; the interactive prompt-to-apply
// fires when stdin is a TTY (scripts/lib/maybe-prompt-apply.mjs). The
// pure parsing / matching / rendering / state logic lives in
// scripts/lib/bookcision.mjs so it can be unit-tested without IO.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";
import { formatAddition, formatBookHeader } from "./lib/diff-format.mjs";
import {
  appendHighlights,
  buildStateEntry,
  decideStateWrite,
  isStateNoOp,
  matchBookcisionToVault,
  parseBookcision,
} from "./lib/bookcision.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const DIR_MODE = typeof argv.dir === "string" && argv.dir.length > 0;
const STATE_FILE = path.join(VAULT, "_meta", "bookcision-state.json");
const GENERATOR = "scripts/import-bookcision.mjs";

await main();

async function main() {
  const inputFiles = await resolveInputFiles(argv);
  if (inputFiles.length === 0) {
    process.stderr.write(
      "usage: node scripts/import-bookcision.mjs <path-to-bookcision.json> [--apply]\n" +
        "       node scripts/import-bookcision.mjs --dir <directory>         [--apply]\n",
    );
    process.exit(2);
  }

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`mode:  ${APPLY ? "APPLY" : "dry-run"}\n`);
  process.stderr.write(`files: ${inputFiles.length}${DIR_MODE ? " (--dir mode)" : ""}\n\n`);

  const vaultEntries = await readVaultIndex(VAULT);
  const state = await readState(STATE_FILE);
  // `state.entries` is keyed by the absolute resolved path of the source
  // JSON file. Storing the resolved path makes `--dir` over a moving
  // directory reproducible across runs.
  /** @type {Record<string, unknown>} */
  const nextEntries = { ...(state?.entries ?? {}) };
  /** @type {Array<() => Promise<void>>} */
  const pendingFileWrites = [];

  const summary = {
    files: inputFiles.length,
    parsed: 0,
    skippedNoOp: 0,
    skippedNoMatch: 0,
    skippedParseError: 0,
    bookUpdates: 0,
    highlightsAppended: 0,
  };
  /** @type {string[]} */
  const unmatched = [];

  // Group writes per-slug so two source files for the same book share
  // a single quotes.md read+write pair.
  /** @type {Map<string, { existing: string, additions: ReturnType<typeof appendHighlights>["written"] }>} */
  const bySlug = new Map();
  /** @type {Array<{ inputPath: string, parsed: ReturnType<typeof parseBookcision>, match: { slug: string, via: string } }>} */
  const matchedThisRun = [];

  for (const inputPath of inputFiles) {
    let parsed;
    try {
      const raw = await fs.readFile(inputPath, "utf8");
      const json = JSON.parse(raw);
      parsed = parseBookcision(json);
    } catch (e) {
      summary.skippedParseError++;
      process.stderr.write(
        `! ${path.relative(process.cwd(), inputPath)}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      continue;
    }
    summary.parsed++;

    // No-op short-circuit: if the state file remembers this exact path
    // with the same source digest, we've already processed it. The
    // per-highlight hash dedupe inside `appendHighlights` would catch
    // it anyway; this is the cheap path that avoids the disk read of
    // an unchanged quotes.md.
    const previousEntry = nextEntries[inputPath];
    if (isStateNoOp(previousEntry, parsed)) {
      summary.skippedNoOp++;
      continue;
    }

    const match = matchBookcisionToVault(parsed, vaultEntries);
    if (!match) {
      summary.skippedNoMatch++;
      unmatched.push(
        `${path.relative(process.cwd(), inputPath)}: "${parsed.title}"${parsed.asin ? ` (ASIN ${parsed.asin})` : ""}`,
      );
      continue;
    }
    matchedThisRun.push({ inputPath, parsed, match });
  }

  // Resolve quotes.md content per slug, accumulating across multiple
  // source files in --dir mode.
  for (const { inputPath, parsed, match } of matchedThisRun) {
    let working = bySlug.get(match.slug);
    if (!working) {
      const quotesPath = path.join(VAULT, match.slug, "quotes.md");
      let existing = "";
      try {
        existing = await fs.readFile(quotesPath, "utf8");
      } catch {
        // Fresh write.
      }
      working = { existing, additions: [] };
      bySlug.set(match.slug, working);
    }

    const { next, written } = appendHighlights(working.existing, parsed.highlights);
    working.existing = next;
    working.additions.push(...written);

    nextEntries[inputPath] = buildStateEntry(match.slug, parsed, written);

    process.stdout.write(
      `${formatBookHeader(`${match.slug}/quotes.md ← ${path.basename(inputPath)} (via ${match.via})`)}\n`,
    );
    if (written.length === 0) {
      process.stdout.write(`  (${parsed.highlights.length} already present, nothing to append)\n`);
    } else {
      for (const h of written) {
        const oneLine = h.text.replace(/\s+/g, " ").trim();
        const truncated = oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
        process.stdout.write(`${formatAddition(truncated)}\n`);
      }
      const skipped = parsed.highlights.length - written.length;
      if (skipped > 0) {
        process.stdout.write(`  (${skipped} already present, skipped)\n`);
      }
    }
  }

  // Build per-slug pending writes from the accumulated state.
  for (const [slug, working] of [...bySlug.entries()].sort()) {
    if (working.additions.length === 0) continue;
    summary.bookUpdates++;
    summary.highlightsAppended += working.additions.length;
    const quotesPath = path.join(VAULT, slug, "quotes.md");
    const next = working.existing;
    pendingFileWrites.push(async () => {
      await fs.writeFile(quotesPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
    });
  }

  // ── Summary ─────────────────────────────────────────────────────────
  process.stderr.write("\n");
  process.stderr.write(`parsed: ${summary.parsed} file(s)\n`);
  process.stderr.write(`no-op (state cache hit): ${summary.skippedNoOp}\n`);
  process.stderr.write(`unmatched: ${summary.skippedNoMatch}\n`);
  if (summary.skippedParseError > 0) {
    process.stderr.write(`parse errors: ${summary.skippedParseError}\n`);
  }
  process.stderr.write(
    `would update ${summary.bookUpdates} book(s) with ${summary.highlightsAppended} new highlight(s)\n`,
  );
  if (unmatched.length > 0) {
    process.stderr.write("\nunmatched files (no vault book joined):\n");
    for (const u of unmatched) process.stderr.write(`  - ${u}\n`);
  }

  // `changeCount` is the number of file mutations (quotes.md writes + a
  // potential state-file write). `pendingFileWrites` only carries quotes
  // updates; the state file is written unconditionally inside `doApply`
  // when its content has actually changed.
  const stateMaybeChanged = summary.bookUpdates > 0 || summary.skippedNoOp < summary.parsed;
  await maybePromptApply({
    apply: APPLY,
    changeCount: pendingFileWrites.length + (stateMaybeChanged ? 1 : 0),
    changeNoun: "bookcision import writes",
    doApply: async () => {
      for (const write of pendingFileWrites) await write();
      const verdict = decideStateWrite({
        newEntries: nextEntries,
        existing: state,
        generator: GENERATOR,
        now: () => new Date().toISOString(),
      });
      if (!verdict.write) {
        process.stderr.write(
          `state unchanged (${verdict.reason}); skipping write to ${STATE_FILE}\n`,
        );
      } else {
        await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
        await fs.writeFile(STATE_FILE, verdict.contents, "utf8");
        process.stderr.write(`wrote ${path.relative(process.cwd(), STATE_FILE)}\n`);
      }
      process.stderr.write(`wrote ${pendingFileWrites.length} quotes file(s)\n`);
    },
  });
}

async function resolveInputFiles(args) {
  if (typeof args.dir === "string" && args.dir.length > 0) {
    const dir = path.resolve(args.dir);
    let names;
    try {
      names = await fs.readdir(dir);
    } catch (e) {
      process.stderr.write(
        `failed to list ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(2);
    }
    return names
      .filter((n) => n.toLowerCase().endsWith(".json"))
      .map((n) => path.resolve(dir, n))
      .sort();
  }
  if (typeof args._[0] === "string" && args._[0].length > 0) {
    return [path.resolve(args._[0])];
  }
  return [];
}

async function readVaultIndex(vault) {
  let dirents;
  try {
    dirents = await fs.readdir(vault, { withFileTypes: true });
  } catch (e) {
    process.stderr.write(`vault read failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return [];
  }
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
    const title = typeof data.title === "string" && data.title.length > 0 ? data.title : slug;
    const asin =
      typeof data.amazon_asin === "string" && data.amazon_asin.length > 0 ? data.amazon_asin : null;
    out.push({ slug, title, asin });
  }
  return out;
}

async function readState(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseArgs(args) {
  /** @type {{ apply?: boolean, dir?: string, vault?: string, _: string[] }} */
  const out = { _: [] };
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
    } else {
      out._.push(a);
    }
  }
  return out;
}
