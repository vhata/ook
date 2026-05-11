#!/usr/bin/env node
// One-shot vault migration: rename every `<slug>/summary.md` to
// `<slug>/progress.md`. The file's role shifted from "full plot recap"
// (in the original tier-1 reveal model) to "running notes the reader
// writes while reading" (current tier-2 deep-notes model), and the
// file name should match the role.
//
// Operator-run only. Default dry-run prints `rename SLUG/summary.md →
// SLUG/progress.md` per book and a count summary; --apply performs the
// rename via `fs.rename` (which uses `git mv` semantics for the next
// commit, preserving history when the target is in the same dir).
//
// Refuses to overwrite an existing progress.md — if both files exist
// for the same book, the user reconciles by hand. Books without a
// summary.md are skipped silently.
//
// Usage:
//   node scripts/rename-summary-to-progress.mjs [--vault PATH] [--apply]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;

// Only run when invoked as a script. Importing the module from a test
// (for future helper exports) should not kick off the migration.
const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await main();
}

async function main() {
  const dirents = await fs.readdir(VAULT, { withFileTypes: true }).catch((e) => {
    process.stderr.write(`cannot read vault at ${VAULT}: ${e.message}\n`);
    process.exit(2);
  });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name)
    .sort();

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${slugs.length}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const pending = [];
  let collisions = 0;
  let absent = 0;

  for (const slug of slugs) {
    const summaryPath = path.join(VAULT, slug, "summary.md");
    const progressPath = path.join(VAULT, slug, "progress.md");

    const [hasSummary, hasProgress] = await Promise.all([
      fileExists(summaryPath),
      fileExists(progressPath),
    ]);

    if (!hasSummary) {
      absent++;
      continue;
    }
    if (hasProgress) {
      collisions++;
      process.stderr.write(
        `! ${slug}: both summary.md AND progress.md exist — reconcile by hand\n`,
      );
      continue;
    }

    process.stdout.write(`rename ${slug}/summary.md → ${slug}/progress.md\n`);
    pending.push(() => fs.rename(summaryPath, progressPath));
  }

  process.stderr.write(
    `\nto rename: ${pending.length} · collisions (skipped): ${collisions} · ` +
      `no summary.md: ${absent}\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "summary.md → progress.md renames",
    doApply: async () => {
      for (const rename of pending) await rename();
      process.stderr.write(`renamed ${pending.length} files\n`);
    },
  });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
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
