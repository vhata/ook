#!/usr/bin/env node
// Walks every see_also in the vault and proposes the reciprocal entry
// where it's missing. If A's see_also includes B but B's see_also
// doesn't include A, propose adding A to B (additive — never kicks
// existing entries out). Pure derivation, idempotent.
//
// Designed to run AFTER the other see_also backfills (series+author
// and tag-Jaccard). Those scripts compute one-sided proposals; this
// pass closes the loop so connections are mutual where space allows.
//
// Constraints:
//   - Skip books already at MAX_SEE_ALSO (default 4) — reciprocity
//     should never bump out an existing entry.
//   - Reciprocity finding mirrors `vault-health` checkCorpus's
//     "asymmetric" finding; this is the script that fixes them.
//
// Defaults to **dry-run**. Pass `--apply` to write back.
//
// Usage:
//   node scripts/backfill-see-also-bidirectional.mjs [--vault PATH] [--apply] [--max N]

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const APPLY = !!argv.apply;
const MAX_SEE_ALSO = Number(argv.max ?? 4);

await main();

async function main() {
  const books = await readVault(VAULT);
  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`books: ${books.length}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY (will rewrite files)" : "dry-run"}\n\n`);

  const bySlug = new Map(books.map((b) => [b.slug, b]));

  // For each book B, collect every A where A.seeAlso includes B but
  // B.seeAlso does not include A.
  const reciprocalsToAdd = new Map(); // B.slug → Set of A.slugs to add
  for (const a of books) {
    for (const bSlug of a.seeAlso) {
      if (bSlug === a.slug) continue;
      const b = bySlug.get(bSlug);
      if (!b) continue; // broken ref — separate vault-lint problem
      if (b.seeAlso.includes(a.slug)) continue; // already reciprocal
      const set = reciprocalsToAdd.get(bSlug) ?? new Set();
      set.add(a.slug);
      reciprocalsToAdd.set(bSlug, set);
    }
  }

  let touched = 0;
  let totalAdded = 0;
  // Pending writes collected during the dry-run pass; fired after the
  // summary by maybePromptApply so a confirmed apply doesn't redo the
  // reciprocity sweep.
  const pending = [];
  // Sort for deterministic output.
  const targets = [...reciprocalsToAdd.keys()].sort();
  for (const targetSlug of targets) {
    const target = bySlug.get(targetSlug);
    if (!target) continue;
    if (target.seeAlso.length >= MAX_SEE_ALSO) continue; // no room

    const additions = [...reciprocalsToAdd.get(targetSlug)].sort();
    const merged = [...target.seeAlso];
    const have = new Set(target.seeAlso);
    for (const a of additions) {
      if (merged.length >= MAX_SEE_ALSO) break;
      if (have.has(a)) continue;
      merged.push(a);
      have.add(a);
    }

    const newAdds = merged.length - target.seeAlso.length;
    if (newAdds === 0) continue;

    touched++;
    totalAdded += newAdds;
    process.stdout.write(
      `${target.slug.padEnd(50)} +${newAdds}: ${merged.slice(target.seeAlso.length).join(", ")}\n`,
    );

    const targetPath = target.path;
    pending.push(() => writeUpdatedSeeAlso(targetPath, merged));
  }

  process.stderr.write(
    `\n${touched} books would gain reciprocal see_also entries (${totalAdded} total)\n`,
  );

  await maybePromptApply({
    apply: APPLY,
    changeCount: pending.length,
    changeNoun: "reciprocal see_also additions",
    doApply: async () => {
      for (const write of pending) await write();
      process.stderr.write(`wrote ${pending.length} books\n`);
    },
  });
}

async function readVault(vaultDir) {
  const dirents = await fs.readdir(vaultDir, { withFileTypes: true });
  const slugs = dirents
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_meta" && d.name !== "bin",
    )
    .map((d) => d.name);
  const out = [];
  for (const slug of slugs) {
    const refPath = path.join(vaultDir, slug, `${slug}.md`);
    let raw;
    try {
      raw = await fs.readFile(refPath, "utf8");
    } catch {
      continue;
    }
    const { data } = matter(raw);
    out.push({
      slug,
      path: refPath,
      seeAlso: Array.isArray(data.see_also)
        ? data.see_also.filter((s) => typeof s === "string")
        : [],
    });
  }
  return out;
}

async function writeUpdatedSeeAlso(filePath, slugs) {
  const raw = await fs.readFile(filePath, "utf8");
  const newLine = `see_also: [${slugs.map(quoteIfNeeded).join(", ")}]`;
  const seeAlsoRe = /^see_also:.*$/m;
  let updated;
  if (seeAlsoRe.test(raw)) {
    updated = raw.replace(seeAlsoRe, newLine);
  } else {
    const frontmatterClose = /^---\s*$/gm;
    let count = 0;
    updated = raw.replace(frontmatterClose, () => {
      count++;
      return count === 2 ? `${newLine}\n---` : "---";
    });
  }
  await fs.writeFile(filePath, updated, "utf8");
}

function quoteIfNeeded(value) {
  if (typeof value !== "string") return JSON.stringify(value);
  const needsQuote = /[:#@!&*%?>|"'`{}[\],\s]/.test(value) || /^[+-]?\d/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
