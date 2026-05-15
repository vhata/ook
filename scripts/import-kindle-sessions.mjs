#!/usr/bin/env node
// One-shot importer for an Amazon privacy-data takeout. Reads
//   <takeout>/Kindle.Devices.ReadingSession/Kindle.Devices.ReadingSession.csv
//   <takeout>/Digital.Content.Ownership/*.json
// joins on ASIN, and writes `_meta/kindle-sessions.json` in the vault.
//
// Pure ingestion — no slug join, no frontmatter writes. The cache is a
// faithful mirror of what's on Amazon's side, keyed by ASIN. Slug
// matching happens later in `scripts/backfill-asin-from-sessions.mjs`.
//
// Behaviour:
//   - Default dry-run; --apply writes (matches the rest of scripts/).
//     Uses scripts/lib/maybe-prompt-apply.mjs for the interactive
//     prompt-to-apply.
//   - --takeout PATH (default ~/tmp/kindle/); --vault PATH or BOOKS_DIR
//     env or ./vault default.
//   - Idempotent: re-running with the same takeout produces the same
//     cache byte-for-byte.
//
// Usage:
//   node scripts/import-kindle-sessions.mjs [--apply]
//                                            [--takeout PATH]
//                                            [--vault PATH]

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";
import {
  buildDailyCounts,
  buildSessionsCache,
  buildUnlinkedTotals,
  parseOwnershipShards,
  parseSessionsCsv,
  summariseCache,
} from "./lib/kindle-sessions.mjs";

const argv = parseArgs(process.argv.slice(2));
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const TAKEOUT = path.resolve(argv.takeout ?? path.join(os.homedir(), "tmp", "kindle"));
const APPLY = !!argv.apply;
const CACHE_FILE = path.join(VAULT, "_meta", "kindle-sessions.json");

await main();

async function main() {
  process.stderr.write(`takeout: ${TAKEOUT}\n`);
  process.stderr.write(`vault:   ${VAULT}\n`);
  process.stderr.write(`mode:    ${APPLY ? "APPLY" : "dry-run"}\n\n`);

  const csvPath = path.join(
    TAKEOUT,
    "Kindle.Devices.ReadingSession",
    "Kindle.Devices.ReadingSession.csv",
  );
  const ownershipDir = path.join(TAKEOUT, "Digital.Content.Ownership");

  const csvText = await readOrFail(csvPath);
  const shardTexts = await readOwnershipShards(ownershipDir);

  const { sessions, skippedNoStart, skippedMalformed } = parseSessionsCsv(csvText);
  process.stderr.write(`sessions:  ${sessions.length} kept\n`);
  process.stderr.write(
    `  skipped: ${skippedNoStart} (no start_timestamp), ${skippedMalformed} (malformed)\n`,
  );

  const { ownership, skipped: skippedShards } = parseOwnershipShards(shardTexts);
  process.stderr.write(
    `ownership: ${Object.keys(ownership).length} books from ${shardTexts.length} shards (${skippedShards} skipped)\n`,
  );

  const cache = buildSessionsCache(sessions, ownership);
  const dailyCounts = buildDailyCounts(sessions);
  const unlinkedSessions = buildUnlinkedTotals(cache);
  const summary = summariseCache(cache);
  process.stderr.write(
    `\ncache: ${summary.asins} ASINs · ${summary.asinsWithTitle} owned · ${summary.totalSessions} sessions · ~${summary.totalHours}h total\n`,
  );
  process.stderr.write(
    `unlinked: ${summary.unlinkedSessions} sessions · ~${summary.unlinkedHours}h (sendtokindle / personal docs / no ASIN match)\n`,
  );
  process.stderr.write(
    `daily counts: ${Object.keys(dailyCounts).length} distinct reading days\n\n`,
  );

  const payload = {
    schemaVersion: 1,
    importedAt: new Date().toISOString(),
    source: {
      sessionsCsv: path.relative(TAKEOUT, csvPath),
      ownershipShards: shardTexts.length,
      skippedShards,
      skippedSessionsNoStart: skippedNoStart,
      skippedSessionsMalformed: skippedMalformed,
    },
    books: cache,
    // Per-day session counts (YYYY-MM-DD → count), local time. Powers
    // the `/stats` heatmap historical-reach backdrop.
    dailyCounts,
    // Pre-summed total for the "unlinked Kindle activity" footnote on
    // `/stats` — derivable from `books` (records with `title: null`)
    // but emitted here so the renderer reads one number instead of
    // walking the whole map.
    unlinkedSessions,
  };
  const serialised = `${JSON.stringify(payload, null, 2)}\n`;

  await maybePromptApply({
    apply: APPLY,
    changeCount: 1,
    changeNoun: "kindle-sessions cache write",
    doApply: async () => {
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE, serialised, "utf8");
      process.stderr.write(
        `wrote ${path.relative(process.cwd(), CACHE_FILE)} (${serialised.length} bytes)\n`,
      );
    },
  });
}

async function readOrFail(filepath) {
  try {
    return await fs.readFile(filepath, "utf8");
  } catch (e) {
    process.stderr.write(
      `failed to read ${filepath}: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.stderr.write(
      "pass --takeout PATH if your takeout is somewhere other than ~/tmp/kindle\n",
    );
    process.exit(2);
  }
}

async function readOwnershipShards(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    process.stderr.write(`failed to list ${dir}: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
  const shardNames = names.filter((n) => n.endsWith(".json"));
  const texts = [];
  for (const name of shardNames) {
    texts.push(await fs.readFile(path.join(dir, name), "utf8"));
  }
  return texts;
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
