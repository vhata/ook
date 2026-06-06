import { cache } from "react";
import { getAllBooks, getManualLogEntries } from "@/lib/books";
import type { Book } from "@/lib/types";

// Pure helpers for the "quiet → return" opportunistic prompt. When the
// owner comes back to /admin to mark something after a long quiet
// stretch — no reading event anywhere in the corpus for ≥ 14 days — the
// agent piggybacks ONE question on the action they came to do:
// "welcome back — anything interesting in the gap?" The answer, when
// given, lands as a Note bullet in `_meta/log.md` riding on the same
// commit as the action. Skip / silence → the action still commits, no
// log entry.
//
// Same offline-clean discipline as the rest of /admin: pure derivation
// from the in-memory corpus (via `getAllBooks` + `getManualLogEntries`),
// no external fetches. `today` is injected so tests share one time
// source — never `new Date()` inline in shaping logic.

const DAY_MS = 86400000;

// "Last event across the whole corpus" — the most recent of any book's
// started / finished / last_progress date plus any manual `_meta/log.md`
// entry date. Returns the max ISO date (YYYY-MM-DD) or null when the
// corpus has no dated activity at all. Pure; exported for tests.
export function corpusLastEventDate(books: Book[], logDates: string[]): string | null {
  let max: string | null = null;
  const consider = (d: string | null | undefined) => {
    if (typeof d !== "string" || d.length === 0) return;
    if (max === null || d > max) max = d;
  };
  for (const b of books) {
    consider(b.started);
    consider(b.finished);
    consider(b.last_progress);
  }
  for (const d of logDates) consider(d);
  return max;
}

// Decide whether the quiet-return question should fire. Qualifies only
// when there IS prior activity (a null lastEventDate — empty corpus —
// never fires) and the gap from that last event to `today` EXCEEDS the
// threshold. Day math is UTC-anchored to match `getCurrentReadingStreak`
// and `src/lib/status.ts`; a future lastEventDate (clock skew) clamps to
// a zero-day gap and so does not fire. Pure; `today` injected.
export function shouldAskQuietReturn(opts: {
  lastEventDate: string | null;
  today: Date;
  thresholdDays?: number;
}): boolean {
  const { lastEventDate, today, thresholdDays = 14 } = opts;
  if (!lastEventDate) return false;
  const anchorMs = Date.parse(`${lastEventDate}T00:00:00Z`);
  if (Number.isNaN(anchorMs)) return false;
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const gapDays = Math.max(0, Math.round((todayMs - anchorMs) / DAY_MS));
  return gapDays > thresholdDays;
}

// React cache() so a single render's call doesn't re-walk the corpus.
// Mirrors the `getFiveStarUnreviewed` idiom. Returns the corpus-wide
// last-event date (or null) ready to feed `shouldAskQuietReturn`.
export const getCorpusLastEventDate = cache(async (): Promise<string | null> => {
  const [books, manual] = await Promise.all([getAllBooks(), getManualLogEntries()]);
  return corpusLastEventDate(
    books,
    manual.map((m) => m.date),
  );
});
