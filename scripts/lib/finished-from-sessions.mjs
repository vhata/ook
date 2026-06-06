// Pure decision logic for `scripts/backfill-finished-from-sessions.mjs`.
//
// Lives in its own module so the guard policy and the date derivation
// can be unit-tested without filesystem IO. The script is a thin
// cache-read + diff + prompt-to-apply shell over `decideFinished`.

import { isoToLocalDate } from "./dates.mjs";

// Default guard window: the Kindle `lastEnd` must be within this many
// days of the book's `started:` date for the inference "last session =
// when I finished" to be trusted.
//
// Why 90, and why measured from `started` rather than from `firstStart`:
// the started-from-sessions backfill's 60-day `lastEnd - firstStart`
// window is not enough on its own. A book read once and then re-opened
// for a single session years later (the Soul Music / The Last Wish
// failure mode) has a `firstStart` close to its true start but a
// `lastEnd` far in the future — the gap between first and last session
// can be years even though the actual read took a week. Anchoring the
// window on the user-confirmed `started:` date and keeping it tight
// rejects those long-tail re-opens: a genuine read completes well
// within a season, while a re-open years later blows straight past 90
// days. 90 also matches the project's existing "paused" threshold in
// `src/lib/status.ts`, so the operator already reasons in 90-day units.
export const DEFAULT_GUARD_DAYS = 90;

/**
 * Number of whole days between two YYYY-MM-DD date strings (b - a),
 * computed in UTC to avoid DST off-by-one. Both inputs are plain
 * calendar dates with no time component, so UTC midnight is the right
 * anchor. Returns a signed integer (negative when b precedes a).
 *
 * @param {string} a - YYYY-MM-DD
 * @param {string} b - YYYY-MM-DD
 * @returns {number}
 */
export function dayDiff(a, b) {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * Detect whether a frontmatter value carries a real date. Mirrors
 * `hasRealStarted` in the started-backfill: a non-empty YYYY-MM-DD
 * string, or a Date gray-matter parsed from a bare YAML date, counts;
 * null / undefined / empty string / placeholder `""` do not.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasRealDate(value) {
  if (typeof value === "string") return value.length > 0;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return false;
}

/**
 * Normalise a frontmatter date value into a YYYY-MM-DD string, or null
 * when there is no real value. Strings are taken verbatim (the vault
 * stores plain `YYYY-MM-DD`); a Date (from gray-matter parsing a bare
 * YAML date) is formatted to its UTC calendar day — gray-matter parses
 * `started: 2024-01-01` to a UTC-midnight Date, so UTC fields round-trip
 * the authored date.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normaliseDate(value) {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getUTCFullYear();
    const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(value.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

/**
 * Decide whether to stamp a `finished:` date on a book, derived from the
 * Kindle `lastEnd` session timestamp, under the strict guard.
 *
 * The decision is pure: it takes the already-parsed book fields and the
 * cache record, and returns one of three outcomes. The caller (the
 * script) is responsible for the fs read/write and the diff/prompt flow.
 *
 * Guard policy (stricter than the started-backfill — this is the point):
 *   1. The book must NOT already carry a real `finished:` value
 *      (per-book skip — manual edits and Goodreads finishes stick).
 *   2. The book MUST already carry a real `started:` value. Without an
 *      anchor for when the read actually happened, there is nothing to
 *      measure the last session against.
 *   3. The cache record must carry a `lastEnd` ISO timestamp that
 *      resolves to a local calendar date.
 *   4. The derived finished date must be >= the `started:` date
 *      (a finish cannot precede its start — contradictory data is left
 *      for operator review, never auto-stamped).
 *   5. The derived finished date must be within `guardDays` of `started:`.
 *      The Soul Music / The Last Wish failure mode — a long-finished
 *      book re-opened for one session years later — fails this and is
 *      skipped.
 *
 * @param {object} args
 * @param {unknown} args.finished - book's existing `finished` frontmatter value
 * @param {unknown} args.started - book's existing `started` frontmatter value
 * @param {{ lastEnd?: unknown } | null | undefined} args.record - cache record for the book's ASIN
 * @param {number} [args.guardDays] - guard window in days (default DEFAULT_GUARD_DAYS)
 * @returns {
 *   | { action: "stamp", finished: string }
 *   | { action: "skip", reason: "already-set" | "no-started" | "no-cache" }
 *   | { action: "guard", reason: "before-started" | "too-far", finished: string, started: string, gapDays: number }
 * }
 */
export function decideFinished({ finished, started, record, guardDays = DEFAULT_GUARD_DAYS }) {
  if (hasRealDate(finished)) {
    return { action: "skip", reason: "already-set" };
  }

  const startedDate = normaliseDate(started);
  if (!startedDate) {
    return { action: "skip", reason: "no-started" };
  }

  const lastEnd = record && typeof record.lastEnd === "string" ? record.lastEnd : null;
  const finishedDate = isoToLocalDate(lastEnd);
  if (!finishedDate) {
    return { action: "skip", reason: "no-cache" };
  }

  const gapDays = dayDiff(startedDate, finishedDate);
  if (gapDays < 0) {
    return {
      action: "guard",
      reason: "before-started",
      finished: finishedDate,
      started: startedDate,
      gapDays,
    };
  }
  if (gapDays > guardDays) {
    return {
      action: "guard",
      reason: "too-far",
      finished: finishedDate,
      started: startedDate,
      gapDays,
    };
  }

  return { action: "stamp", finished: finishedDate };
}
