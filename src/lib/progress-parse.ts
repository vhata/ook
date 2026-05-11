// Heuristic parser: pull a 0–100 percent estimate out of the prose
// `progress` frontmatter field. Used by the home-page bookmark-ribbon
// indicator on currently-reading cards.
//
// Patterns recognised, in priority order:
//   1. Bare percentage:                      "47%", "47 %"
//   2. Explicit fraction:                    "142 of 350", "5/12"
//   3. Page reference + totalPages context:  "p. 142" + Book.pages=350
//   4. Chapter reference + "of N":           "chapter 5 of 20"
//
// Prose markers like "halfway", "nearly done" are deliberately NOT
// supported — they encode a guess the reader could just as well type
// as a percent if they wanted ribbon precision. The parser returns
// null when nothing matches; the caller suppresses the ribbon.
//
// Safety: clamps the result into [0, 100] in case the prose says
// something like "page 400" for a 350-page book. Returns null when
// the fraction is degenerate (denominator 0).

export type ProgressEstimate = {
  // Integer 0..100.
  percent: number;
  // Which pattern matched; useful for tests and for a tooltip later.
  source: "percent" | "fraction" | "page" | "chapter";
};

export function parseProgress(
  progress: string,
  totalPages?: number | null,
): ProgressEstimate | null {
  if (typeof progress !== "string") return null;
  const text = progress.trim();
  if (text.length === 0) return null;

  // 1. Bare percentage. Catches "47%" / "47 %" / "around 60%".
  const percent = /(\d{1,3})\s*%/.exec(text);
  if (percent) {
    const n = clampPercent(Number(percent[1]));
    return { percent: n, source: "percent" };
  }

  // 2. Chapter reference. "ch 5 of 20", "chapter 5 of 20". Tried
  //    BEFORE the generic fraction matcher because "chapter 5 of 20"
  //    would otherwise match the fraction pattern with the wrong
  //    source label — same percent, but we want the labelled source
  //    so tests / future tooltips can distinguish.
  const chapter = /\b(?:ch\.?|chapters?)\s*(\d{1,3})\s+of\s+(\d{1,3})\b/i.exec(text);
  if (chapter) {
    const num = Number(chapter[1]);
    const den = Number(chapter[2]);
    if (den > 0) return { percent: fractionToPercent(num, den), source: "chapter" };
  }

  // 3. Explicit fraction "N of M" or "N/M". Reject when M <= 0.
  //    Avoid matching dates ("2026-05-11" → 2026/05) by requiring a
  //    surrounding word boundary AND a "of" / "/" separator only.
  const fraction =
    /\b(\d{1,4})\s+of\s+(\d{1,4})\b/i.exec(text) ?? /\b(\d{1,4})\/(\d{1,4})\b/.exec(text);
  if (fraction) {
    const num = Number(fraction[1]);
    const den = Number(fraction[2]);
    if (den > 0) return { percent: fractionToPercent(num, den), source: "fraction" };
  }

  // 4. Page reference. "p. 142" / "page 142". Only useful with a
  //    book-level totalPages context (passed in from frontmatter).
  if (totalPages && totalPages > 0) {
    const page = /\b(?:p\.?|pages?)\s*(\d{1,4})\b/i.exec(text);
    if (page) {
      const n = Number(page[1]);
      return { percent: fractionToPercent(n, totalPages), source: "page" };
    }
  }

  return null;
}

function fractionToPercent(num: number, den: number): number {
  return clampPercent(Math.round((num / den) * 100));
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}
