// Pure helpers for the Goodreads-CSV → vault promoter. Lives in a
// separate module from the script so the title/series-splitting logic
// can be unit-tested without spinning up filesystem IO.
//
// The interesting case this module exists for is Goodreads titles that
// carry BOTH a subtitle-in-parens AND a series-in-parens, e.g.
// `"We Are Legion (We Are Bob) (Bobiverse, #1)"`. A naive lazy regex
// anchored on the first `(...)` swallows the inner closing paren into
// the series field; we anchor on the LAST `(...)` instead.

// Trailing-parenthetical detector for the "Series, #N" suffix.
//
// `^(.+) \(([^()]+)\)\s*$` — the title (group 1) is greedy, so it
// matches everything up to the LAST trailing `(...)`. The contents of
// that last paren block (group 2) are restricted to `[^()]+`, so a
// title like `"We Are Legion (We Are Bob) (Bobiverse, #1)"` peels off
// only `(Bobiverse, #1)` as the series and leaves `"We Are Legion (We
// Are Bob)"` as the title.
//
// Caveat: anything in the trailing parens is treated as a candidate
// series suffix. `cleanTitleAndSeries` then narrows that to "looks
// numeric" — `(A Brief History)` falls through. Real-world Goodreads
// exports nearly always put a numbered series in trailing parens, so
// this heuristic is correct in the dominant case; the user corrects
// the rare miss case-by-case in the vault.
const TRAILING_PARENS_RE = /^(.+) \(([^()]+)\)\s*$/;

/**
 * Split a raw Goodreads title into a clean title and an optional
 * series suffix.
 *
 * Returns `series: null` when:
 *   - the title has no trailing `(...)` at all, or
 *   - the trailing parenthetical contains no number-like marker (so
 *     it's probably a subtitle, not a series).
 *
 * The series string is normalised: `"Series, #N"` → `"Series #N"`, and
 * runs of whitespace collapsed. This matches the vault's stored shape
 * (see existing reference files under the vault root).
 *
 * @param {string} rawTitle
 * @returns {{ title: string, series: string | null }}
 */
export function cleanTitleAndSeries(rawTitle) {
  // YAML coerces values like "1984" to numbers — re-stringify defensively.
  const title = String(rawTitle ?? "").trim();
  if (title.length === 0) return { title: "", series: null };

  const match = TRAILING_PARENS_RE.exec(title);
  if (!match) return { title, series: null };

  const [, before, inside] = match;
  // Heuristic: only treat the parenthetical as a series suffix if it
  // contains a number (e.g. "#3", "Vol. 2", "Book 1"). Otherwise it's
  // probably part of the title (e.g. "Sapiens (A Brief History)").
  const hasNumber = /[#\d]/.test(inside);
  if (!hasNumber) return { title, series: null };

  // Normalise "Series, #N" → "Series #N"; collapse whitespace runs.
  // Trim first so the comma-then-end pattern still anchors when the
  // captured `inside` happens to carry trailing whitespace.
  const seriesNorm = inside
    .trim()
    .replace(/,\s*(#[\d.]+)$/, " $1")
    .replace(/\s+/g, " ")
    .trim();
  return { title: before.trim(), series: seriesNorm };
}
