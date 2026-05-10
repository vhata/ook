#!/usr/bin/env node
// Pushes the vault's reading state up to Hardcover so the user has a
// durable second copy of "what I'm reading, what I've read, when, and
// how I felt about it." Goodreads' write API has been dead since
// 2020-12-08; Hardcover is the only viable target.
//
// Direction is one-way: vault → Hardcover. The vault is source of truth.
// Hardcover state we read at insert/update time is used purely to (a)
// decide insert-vs-update, (b) avoid clobbering a more granular
// Hardcover rating with a coarser vault one, and (c) flag noisy cases
// (vault says TBR, Hardcover says Read) in the summary so the user
// can investigate before re-running. The push still happens — the
// vault is authoritative.
//
// Idempotency comes from two layers:
//
//   1. A local cache at `<vault>/_meta/hardcover-sync-state.json`
//      keyed by vault slug records the last vault state we pushed.
//      Re-runs whose vault state matches the cache short-circuit
//      with zero Hardcover round-trips. This is the cheap path.
//
//   2. When the cache says we should push, we still query Hardcover
//      first to check whether the same row already has the same state
//      (a previous run might have written but we crashed before
//      saving the cache). Only when the diff is real do we mutate.
//
// Mapping (verified by introspection on 2026-05-09):
//   - tbr      → status_id 1 (Want to Read)
//   - reading  → status_id 2 (Currently Reading)
//   - finished → status_id 3 (Read)
//   - paused   → status_id 4 (Paused)
//   - abandoned→ status_id 5 (Did Not Finish)
//
// Rating scale: Hardcover stores rating as `numeric` on the same 0-5
// half-star scale the vault uses. NO conversion is needed — the
// original spec was wrong. The script's `decideRatingPush` policy
// preserves Hardcover's higher precision when the difference is
// under half a star.
//
// Auth: requires HARDCOVER_TOKEN in env. Same JWT shape as the
// existing Hardcover scripts.
//
// Usage:
//   HARDCOVER_TOKEN=... node scripts/sync-hardcover-status.mjs [--apply]
//                                                              [--vault PATH]
//                                                              [--slug SLUG]
//                                                              [--rate-ms MS]
//                                                              [--debug]
//                                                              [--refresh]
//
//   --apply        actually fire the mutations (default: dry-run summary)
//   --slug SLUG    only sync one book (testing)
//   --rate-ms MS   request spacing (default 1100ms, under Hardcover's 60/min)
//   --debug        print every GraphQL request + response
//   --refresh      ignore the local sync-state cache and re-check every book
//                  against Hardcover. Slower, but useful when the cache file
//                  is suspect.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { maybePromptApply } from "./lib/maybe-prompt-apply.mjs";
import { decideAction, snapshotForCache, vaultStateMatchesCache } from "./lib/hardcover-sync.mjs";

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
const HARDCOVER_CACHE = path.join(VAULT, "_meta", "hardcover-books.json");
const SYNC_STATE_FILE = path.join(VAULT, "_meta", "hardcover-sync-state.json");

const VALID_STATUSES = new Set(["tbr", "reading", "finished", "paused", "abandoned"]);

await main();

async function main() {
  if (!TOKEN) {
    process.stderr.write(
      "HARDCOVER_TOKEN is unset. Create a free token at https://hardcover.app/account/api\n",
    );
    process.exit(2);
  }

  process.stderr.write(`vault: ${VAULT}\n`);
  process.stderr.write(`mode: ${APPLY ? "APPLY (will mutate Hardcover)" : "dry-run"}\n\n`);

  // 1. Load auxiliary state.
  const hardcoverCache = await readJson(HARDCOVER_CACHE).catch(() => ({ records: {} }));
  const syncState = REFRESH
    ? { entries: {} }
    : await readJson(SYNC_STATE_FILE).catch(() => ({ entries: {} }));

  // 2. Walk the vault.
  const candidates = await readVaultBooks(VAULT);
  const filtered = SLUG_FILTER ? candidates.filter((c) => c.slug === SLUG_FILTER) : candidates;
  process.stderr.write(`books: ${filtered.length}\n`);

  // 3. Resolve the current Hardcover user (used to scope existence
  // checks). One round-trip; cheap.
  const me = await graphql(`
    query Me {
      me {
        id
        username
      }
    }
  `);
  const userId = me?.data?.me?.[0]?.id;
  if (!Number.isInteger(userId)) {
    throw new Error(`Could not determine Hardcover user id from /me: ${JSON.stringify(me)}`);
  }
  process.stderr.write(`hardcover user: id=${userId} username=${me.data.me[0].username}\n\n`);

  /** @type {Array<() => Promise<void>>} */
  const pendingMutations = [];
  const summary = {
    insert: 0,
    update: 0,
    skipNoChange: 0,
    skipCacheHit: 0,
    skipNoMapping: 0,
    skipInvalidStatus: 0,
    errors: 0,
  };
  const skippedNoMapping = [];
  const warnings = [];

  for (const c of filtered) {
    if (!VALID_STATUSES.has(c.status)) {
      summary.skipInvalidStatus++;
      warnings.push(`${c.slug}: status "${c.status}" is not in the supported set; skipped`);
      continue;
    }

    const hardcoverRecord = hardcoverCache.records?.[c.slug];
    const hardcoverBookId = hardcoverRecord?.hardcoverId ?? null;
    if (!hardcoverBookId) {
      summary.skipNoMapping++;
      skippedNoMapping.push(c.slug);
      continue;
    }

    const snapshot = snapshotForCache(c);
    const cached = syncState.entries?.[c.slug];
    if (!REFRESH && vaultStateMatchesCache(snapshot, cached)) {
      summary.skipCacheHit++;
      continue;
    }

    // Cache miss → query Hardcover for the existing user_book row to
    // decide insert vs update vs skip-no-change.
    let remote;
    try {
      remote = await fetchUserBook({ userId, bookId: hardcoverBookId });
    } catch (e) {
      summary.errors++;
      warnings.push(`${c.slug}: lookup failed — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    await sleep(RATE_MS);

    const decision = decideAction({
      vault: c,
      remote,
      hardcoverBookId,
    });

    for (const w of decision.warnings) {
      warnings.push(`${c.slug}: ${w}`);
    }

    if (decision.action === "skip-no-change") {
      summary.skipNoChange++;
      // Still update the local cache so the next dry-run is fast.
      syncState.entries = syncState.entries ?? {};
      syncState.entries[c.slug] = snapshot;
      continue;
    }

    const action = decision.action;
    process.stderr.write(
      `→ ${c.slug}: ${action} (status=${c.status}, rating=${c.rating ?? "—"}, started=${c.started ?? "—"}, finished=${c.finished ?? "—"})\n`,
    );
    if (action === "insert") summary.insert++;
    else summary.update++;

    pendingMutations.push(async () => {
      try {
        let userBookId = remote?.id ?? null;
        if (action === "insert") {
          const result = await graphql(
            /* GraphQL */ `
              mutation Insert($object: UserBookCreateInput!) {
                insert_user_book(object: $object) {
                  id
                  error
                }
              }
            `,
            { object: decision.payload },
          );
          if (result.errors) {
            throw new Error(`GraphQL: ${JSON.stringify(result.errors)}`);
          }
          if (result.data?.insert_user_book?.error) {
            throw new Error(`Hardcover error: ${result.data.insert_user_book.error}`);
          }
          userBookId = result.data?.insert_user_book?.id ?? null;
        } else {
          if (!userBookId) {
            throw new Error("update with no remote user_book id — internal bug");
          }
          // update_user_book takes the id separately; the object must
          // not contain book_id (it's immutable on the row).
          const updatePayload = { ...decision.payload };
          delete updatePayload.book_id;
          const result = await graphql(
            /* GraphQL */ `
              mutation Update($id: Int!, $object: UserBookUpdateInput!) {
                update_user_book(id: $id, object: $object) {
                  id
                  error
                }
              }
            `,
            { id: userBookId, object: updatePayload },
          );
          if (result.errors) {
            throw new Error(`GraphQL: ${JSON.stringify(result.errors)}`);
          }
          if (result.data?.update_user_book?.error) {
            throw new Error(`Hardcover error: ${result.data.update_user_book.error}`);
          }
        }

        // Push read-session dates (Hardcover's user_book_reads table)
        // when the vault has any. We use upsert_user_book_reads with a
        // single read; Hardcover dedupes server-side by (user_book_id,
        // started_at, finished_at).
        if (userBookId && decision.reads) {
          await sleep(RATE_MS);
          const readsResult = await graphql(
            /* GraphQL */ `
              mutation UpsertReads($user_book_id: Int!, $datesRead: [DatesReadInput!]!) {
                upsert_user_book_reads(user_book_id: $user_book_id, datesRead: $datesRead) {
                  user_book_id
                  error
                }
              }
            `,
            {
              user_book_id: userBookId,
              datesRead: [
                {
                  started_at: decision.reads.started_at,
                  finished_at: decision.reads.finished_at,
                },
              ],
            },
          );
          if (readsResult.errors) {
            throw new Error(`GraphQL (reads): ${JSON.stringify(readsResult.errors)}`);
          }
          if (readsResult.data?.upsert_user_book_reads?.error) {
            warnings.push(
              `${c.slug}: reads upsert reported "${readsResult.data.upsert_user_book_reads.error}" — continuing`,
            );
          }
        }

        // Write the cache only after a successful push. If we crashed
        // before this point, the next run will re-check Hardcover and
        // decide-skip on no-change, so no double-write.
        syncState.entries = syncState.entries ?? {};
        syncState.entries[c.slug] = snapshot;
      } finally {
        await sleep(RATE_MS);
      }
    });
  }

  // ── Summary ────────────────────────────────────────────────────────
  process.stderr.write("\n");
  process.stderr.write(`would insert: ${summary.insert}\n`);
  process.stderr.write(`would update: ${summary.update}\n`);
  process.stderr.write(`skip (no change vs Hardcover): ${summary.skipNoChange}\n`);
  process.stderr.write(`skip (cache hit, vault unchanged): ${summary.skipCacheHit}\n`);
  process.stderr.write(`skip (no Hardcover mapping): ${summary.skipNoMapping}\n`);
  if (summary.skipInvalidStatus > 0) {
    process.stderr.write(`skip (unsupported status): ${summary.skipInvalidStatus}\n`);
  }
  if (summary.errors > 0) {
    process.stderr.write(`errors during lookup: ${summary.errors}\n`);
  }
  if (skippedNoMapping.length > 0 && skippedNoMapping.length <= 12) {
    process.stderr.write(`  unmapped slugs: ${skippedNoMapping.join(", ")}\n`);
  } else if (skippedNoMapping.length > 12) {
    process.stderr.write(
      `  unmapped slugs (first 12 of ${skippedNoMapping.length}): ${skippedNoMapping.slice(0, 12).join(", ")}\n`,
    );
  }
  if (warnings.length > 0) {
    process.stderr.write(`\nwarnings:\n`);
    for (const w of warnings) process.stderr.write(`  - ${w}\n`);
  }

  // Apply path: maybePromptApply runs `doApply` on --apply or on a
  // y-confirmed interactive prompt.
  await maybePromptApply({
    apply: APPLY,
    changeCount: pendingMutations.length,
    changeNoun: "Hardcover mutations",
    doApply: async () => {
      for (const m of pendingMutations) {
        try {
          await m();
        } catch (e) {
          summary.errors++;
          process.stderr.write(`  error: ${e instanceof Error ? e.message : String(e)}\n`);
        }
      }
      // Persist the sync-state cache (skip-no-change cases above also
      // updated it in-memory).
      await fs.mkdir(path.dirname(SYNC_STATE_FILE), { recursive: true });
      const out = {
        updated: new Date().toISOString(),
        generator: "scripts/sync-hardcover-status.mjs",
        entries: syncState.entries ?? {},
      };
      await fs.writeFile(SYNC_STATE_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
      process.stderr.write(`wrote ${SYNC_STATE_FILE}\n`);
    },
  });
}

// ── Vault reader ─────────────────────────────────────────────────────

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
    out.push({
      slug,
      status: typeof data.status === "string" ? data.status : null,
      rating: typeof data.rating === "number" ? data.rating : null,
      started: data.started ? String(data.started) : null,
      finished: data.finished ? String(data.finished) : null,
      goodreadsId:
        data.goodreads_id != null && data.goodreads_id !== "" ? String(data.goodreads_id) : null,
    });
  }
  return out
    .filter((b) => typeof b.status === "string" && b.status.length > 0)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// ── Hardcover ────────────────────────────────────────────────────────

async function graphql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "user-agent": "ook/1.0 (+https://github.com/vhata/ook)",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`HTTP ${res.status} from Hardcover — body: ${body}`);
  }
  const json = await res.json();
  if (DEBUG) {
    process.stderr.write(`  graphql: ${JSON.stringify(json)}\n`);
  }
  return json;
}

async function fetchUserBook({ userId, bookId }) {
  const json = await graphql(
    /* GraphQL */ `
      query UserBookByBook($uid: Int!, $bid: Int!) {
        user_books(where: { user_id: { _eq: $uid }, book_id: { _eq: $bid } }, limit: 1) {
          id
          status_id
          rating
          first_started_reading_date
          last_read_date
        }
      }
    `,
    { uid: userId, bid: bookId },
  );
  if (json.errors) {
    throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  }
  return json.data?.user_books?.[0] ?? null;
}

// ── helpers ──────────────────────────────────────────────────────────

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
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
