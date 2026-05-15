// Pure helpers for `scripts/sync-hardcover-status.mjs`. Network-free
// so the unit tests can target this directly without mocking fetch.
//
// What lives here:
//
//   - Status mapping: vault BookStatus ("tbr" | "reading" | "finished"
//     | "abandoned" | "paused") → Hardcover user_book_statuses.id.
//     Verified by introspection on 2026-05-09:
//       1 = Want to Read, 2 = Currently Reading, 3 = Read,
//       4 = Paused,      5 = Did Not Finish.
//
//   - Vault → Hardcover payload construction. Hardcover's
//     UserBookCreateInput / UserBookUpdateInput accepts:
//       book_id, status_id, rating (numeric, 0-5),
//       first_started_reading_date (date, YYYY-MM-DD),
//       last_read_date (date, YYYY-MM-DD)
//     plus a long tail we don't need. `started_at` / `finished_at`
//     for individual read-sessions live on `user_book_reads`, upserted
//     separately via `upsert_user_book_reads`.
//
//   - Diff detection: compare a vault payload (the *intended* state)
//     against either (a) the local sync-state cache from the previous
//     run or (b) the existing Hardcover record from a fresh `me`-scoped
//     query. Returns the action to take (skip / insert / update) plus
//     a list of human-readable warnings ("vault status flipped
//     finished→tbr — pushing anyway", "Hardcover rating differs by
//     more than half a star, not clobbering").
//
// The rating semantics are worth a paragraph because the spec was
// initially wrong about them: Hardcover stores ratings on the same 0-5
// half-star scale the vault uses (`numeric` column, e.g. 4.5). NO
// scale conversion is needed. The defensible behaviour: push the vault
// rating when (a) Hardcover has none, (b) the two agree, or (c) the
// vault rating differs by ≥ 0.5 from Hardcover's. When the vault
// rating is unset we never clear an existing Hardcover rating —
// blank in the vault is "I haven't decided", not "remove this".

/** @typedef {"tbr" | "reading" | "finished" | "abandoned" | "paused"} VaultStatus */

/**
 * Hardcover user_book_statuses.id values, verified by introspection.
 * The "Ignored" status (id 6) has no vault analogue.
 */
export const STATUS_ID = Object.freeze({
  tbr: 1,
  reading: 2,
  finished: 3,
  paused: 4,
  abandoned: 5,
});

/**
 * @param {VaultStatus} status
 * @returns {number}
 */
export function statusIdFor(status) {
  const id = STATUS_ID[status];
  if (typeof id !== "number") {
    throw new Error(`Unknown vault status: ${status}`);
  }
  return id;
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null} ISO date YYYY-MM-DD or null when unparseable
 */
export function normalizeDate(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s.length === 0) return null;
  // Accept YYYY-MM-DD (frontmatter usual) and YYYY-MM-DDTHH:MM:SSZ.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m) return null;
  return m[1];
}

/**
 * Build the payload we'd send to insert_user_book / update_user_book
 * from a vault book. Returns the object literal that goes under
 * `object:` in the GraphQL mutation. We deliberately omit fields the
 * vault doesn't track (notes, privacy, edition_id, …) so the script
 * doesn't clobber them on update.
 *
 * @param {object} vault
 * @param {string} vault.slug
 * @param {VaultStatus} vault.status
 * @param {number | null} vault.rating         - vault rating, 0-5 half-star
 * @param {string | null} vault.started        - YYYY-MM-DD or null
 * @param {string | null} vault.finished       - YYYY-MM-DD or null
 * @param {number} hardcoverBookId
 * @returns {Record<string, unknown>}
 */
export function buildUserBookPayload(vault, hardcoverBookId) {
  /** @type {Record<string, unknown>} */
  const payload = {
    book_id: hardcoverBookId,
    status_id: statusIdFor(vault.status),
  };

  // Rating: omit when null. The decision to *update* an existing
  // non-null Hardcover rating is made in `decideRatingPush` below;
  // this function just produces the candidate payload.
  if (vault.rating != null && Number.isFinite(vault.rating)) {
    payload.rating = vault.rating;
  }

  // Dates: pass YYYY-MM-DD only. Hardcover's `first_started_reading_date`
  // and `last_read_date` are `date` columns (not timestamptz).
  const started = normalizeDate(vault.started);
  if (started) payload.first_started_reading_date = started;

  const finished = normalizeDate(vault.finished);
  if (finished) payload.last_read_date = finished;

  return payload;
}

/**
 * Decide whether to include `rating` in the update payload. Vault is
 * source of truth, but we don't clobber a more granular Hardcover
 * rating with a coarser one.
 *
 * @param {number | null | undefined} vaultRating
 * @param {number | null | undefined} hardcoverRating
 * @returns {{ push: boolean; warning: string | null }}
 */
export function decideRatingPush(vaultRating, hardcoverRating) {
  // No vault rating → never clear an existing Hardcover rating.
  if (vaultRating == null) return { push: false, warning: null };
  // No Hardcover rating → push.
  if (hardcoverRating == null) return { push: true, warning: null };
  // Identical → skip the field (saves a write, but harmless either way).
  if (Math.abs(vaultRating - hardcoverRating) < 0.01) {
    return { push: false, warning: null };
  }
  // Differs by half a star or less → likely a precision difference
  // (Hardcover at 4.5, vault at 4 because the vault doesn't store
  // halves). Skip and warn. The strict `<=` is deliberate: the boundary
  // case (vault 4 vs Hardcover 4.5) is exactly the one we care about.
  if (Math.abs(vaultRating - hardcoverRating) <= 0.5) {
    return {
      push: false,
      warning: `vault rating ${vaultRating} ≠ Hardcover ${hardcoverRating} by ≤ 0.5; preserving Hardcover's granularity`,
    };
  }
  // Otherwise, the user genuinely changed their mind in the vault.
  // Push, and warn loudly.
  return {
    push: true,
    warning: `vault rating ${vaultRating} replaces Hardcover ${hardcoverRating}`,
  };
}

/**
 * Compare a fresh vault snapshot against the previous sync-state entry
 * (when present) to short-circuit no-op pushes. The cache key is the
 * vault slug; the cached object is the last *vault state* we pushed,
 * NOT the last Hardcover response — that way a manual change on
 * Hardcover doesn't make the diff wedge.
 *
 * @param {object} current   - vault state right now
 * @param {string} current.status
 * @param {number | null} current.rating
 * @param {string | null} current.started
 * @param {string | null} current.finished
 * @param {object | null | undefined} cached - previous pushed state (same shape) or null
 * @returns {boolean} true iff the vault state matches the cached state
 */
export function vaultStateMatchesCache(current, cached) {
  if (!cached) return false;
  if (cached.status !== current.status) return false;
  // Treat null and undefined as the same.
  if (((cached.rating ?? null) === null) !== ((current.rating ?? null) === null)) return false;
  if (cached.rating != null && current.rating != null) {
    if (Math.abs(cached.rating - current.rating) > 0.001) return false;
  }
  if (normalizeDate(cached.started) !== normalizeDate(current.started)) return false;
  if (normalizeDate(cached.finished) !== normalizeDate(current.finished)) return false;
  return true;
}

/**
 * Decide what to do with a single book given its vault state and
 * current Hardcover record. Pure; the caller fires the actual GraphQL.
 *
 * @param {object} args
 * @param {object} args.vault     - vault state (status, rating, started, finished)
 * @param {object | null} args.remote - current user_book row from Hardcover, or null
 * @param {number} args.hardcoverBookId
 * @returns {{
 *   action: "insert" | "update" | "skip-no-change";
 *   payload: Record<string, unknown> | null;
 *   warnings: string[];
 *   reads: { started_at: string | null; finished_at: string | null } | null;
 * }}
 */
export function decideAction({ vault, remote, hardcoverBookId }) {
  const warnings = [];
  const candidate = buildUserBookPayload(vault, hardcoverBookId);

  // Rating: filter against remote when we have one.
  if ("rating" in candidate) {
    const decision = decideRatingPush(vault.rating, remote?.rating ?? null);
    if (decision.warning) warnings.push(decision.warning);
    if (!decision.push) delete candidate.rating;
  }

  // Loud-warning case: vault flipped to TBR but Hardcover already says Read.
  // Still push the vault state — vault is source of truth — but flag it.
  if (remote && remote.status_id === STATUS_ID.finished) {
    if (vault.status !== "finished") {
      warnings.push(
        `vault status "${vault.status}" overrides Hardcover's "Read" — the user is the source of truth, but verify`,
      );
    }
  }

  // Reads: only push a started_at / finished_at pair when the vault has
  // them and the status implies a real read happened. Hardcover stores
  // these on user_book_reads, not user_books.
  let reads = null;
  const startedAt = normalizeDate(vault.started);
  const finishedAt = normalizeDate(vault.finished);
  if (startedAt || finishedAt) {
    reads = { started_at: startedAt, finished_at: finishedAt };
  }

  if (!remote) {
    return { action: "insert", payload: candidate, warnings, reads };
  }

  // Compute whether anything would actually change. Only the four
  // fields the script writes count — date_added, edition_id etc. are
  // user-controlled on Hardcover and out of scope here.
  const fieldsThatMightChange = [
    "status_id",
    "rating",
    "first_started_reading_date",
    "last_read_date",
  ];
  let changed = false;
  for (const f of fieldsThatMightChange) {
    if (!(f in candidate)) continue;
    if (remote[f] == null && candidate[f] == null) continue;
    if (remote[f] !== candidate[f]) {
      // Date fields can come back as full ISO timestamps from some
      // Hasura configs; normalise both sides before comparing.
      if (f === "first_started_reading_date" || f === "last_read_date") {
        if (normalizeDate(remote[f]) === normalizeDate(candidate[f])) continue;
      }
      changed = true;
      break;
    }
  }
  if (!changed) {
    return { action: "skip-no-change", payload: null, warnings, reads };
  }
  return { action: "update", payload: candidate, warnings, reads };
}

/**
 * Cache-state shape we persist between runs in
 * `<vault>/_meta/hardcover-sync-state.json`. Keyed by vault slug.
 *
 * Every value is a JSON-round-trip-stable primitive (`string | number
 * | null`). `undefined`, `NaN`, and `Infinity` are normalised to `null`
 * so the in-memory snapshot is byte-identical to what JSON.stringify
 * would write and JSON.parse would read back — keeping the no-op-skip
 * guard honest.
 *
 * @param {object} vault
 * @returns {{ status: string | null; rating: number | null; started: string | null; finished: string | null }}
 */
export function snapshotForCache(vault) {
  const rating = vault.rating;
  return {
    status: typeof vault.status === "string" ? vault.status : null,
    rating: typeof rating === "number" && Number.isFinite(rating) ? rating : null,
    started: normalizeDate(vault.started),
    finished: normalizeDate(vault.finished),
  };
}

/**
 * Deterministic JSON serialiser. Used by the sync-state cache writer
 * to decide whether anything material changed: if the new entries
 * stringify to the same string as the existing entries, skip the
 * write entirely so the auto-hygiene workflow doesn't produce a no-op
 * commit that just bumps the `updated` timestamp.
 *
 * Sorts object keys at every depth so two equivalent objects with
 * different key insertion orders produce identical strings; arrays
 * stay in their natural order. Mirrors `JSON.stringify`'s treatment
 * of `undefined`: keys whose value is `undefined` are dropped (in
 * objects) or rendered as `null` (in arrays). Otherwise an
 * in-memory `{a: undefined}` would stringify to `'{"a":undefined}'`
 * while its on-disk round-trip (which `JSON.stringify` omitted the
 * undefined from) stringifies to `'{}'` — a guard-fooling
 * structural-equal-but-byte-different pair that produces a no-op
 * cache write.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === undefined) return JSON.stringify(null);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    // JSON.stringify renders undefined array slots as null; match that.
    const parts = value.map((v) => (v === undefined ? "null" : stableStringify(v)));
    return `[${parts.join(",")}]`;
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${parts.join(",")}}`;
}

/**
 * Decide whether the sync-state cache file needs to be written, and
 * what to write. Pure — the caller does the I/O. Split out from the
 * script body so two consecutive runs can be exercised against the
 * same fixture and asserted byte-identical.
 *
 * The previous shape compared in-memory entries against the on-disk
 * file with `stableStringify` and skipped the write when equal, but
 * the guard sat inline inside the script's main flow and was awkward
 * to regression-test. Encoding it as a pure helper lets us pin the
 * "two runs with identical inputs produce identical bytes" contract
 * the auto-hygiene workflow depends on.
 *
 * @param {object} args
 * @param {Record<string, unknown>} args.newEntries     - entries we'd write now
 * @param {Record<string, unknown> | null | undefined} args.existing - parsed contents of the on-disk file, or null
 * @param {string} args.generator                       - generator string for the file metadata
 * @param {() => string} args.now                       - returns the `updated` ISO timestamp; injectable for tests
 * @returns {{ write: false; reason: string } | { write: true; contents: string }}
 */
export function decideSyncStateWrite({ newEntries, existing, generator, now }) {
  const existingEntries = existing?.entries ?? {};
  if (stableStringify(newEntries) === stableStringify(existingEntries)) {
    return { write: false, reason: "entries unchanged" };
  }
  const out = {
    updated: now(),
    generator,
    entries: newEntries,
  };
  return { write: true, contents: JSON.stringify(out, null, 2) + "\n" };
}
