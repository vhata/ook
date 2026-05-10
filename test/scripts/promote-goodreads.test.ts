// Pins behaviour of the Goodreads-CSV → vault promoter's title/series
// splitter. The interesting case is double-paren titles where Goodreads
// carries BOTH a subtitle-in-parens AND a series-in-parens — the lazy
// regex that used to live in the script swallowed the inner closing
// paren into the series field. The fixed regex anchors on the LAST
// `(...)` instead, so the subtitle stays with the title.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs lib lives outside the TS project graph
import { cleanTitleAndSeries } from "../../scripts/lib/promote-goodreads.mjs";

describe("cleanTitleAndSeries", () => {
  it("returns the title unchanged and null series when no parens are present", () => {
    expect(cleanTitleAndSeries("Piranesi")).toEqual({ title: "Piranesi", series: null });
  });

  it("splits a simple `(Series, #N)` suffix and normalises the comma away", () => {
    expect(cleanTitleAndSeries("A Game of Thrones (A Song of Ice and Fire, #1)")).toEqual({
      title: "A Game of Thrones",
      series: "A Song of Ice and Fire #1",
    });
  });

  it("anchors on the LAST `(...)` so subtitle-in-parens stays with the title", () => {
    // The bug this test exists for: with the previous lazy regex,
    // group 1 captured only "We Are Legion" and group 2 swallowed the
    // inner closing paren as "We Are Bob) (Bobiverse, #1".
    expect(cleanTitleAndSeries("We Are Legion (We Are Bob) (Bobiverse, #1)")).toEqual({
      title: "We Are Legion (We Are Bob)",
      series: "Bobiverse #1",
    });
  });

  it("treats a comma-only suffix (no trailing parens) as title-only", () => {
    expect(cleanTitleAndSeries("The Sandman, Vol. 1: Preludes & Nocturnes")).toEqual({
      title: "The Sandman, Vol. 1: Preludes & Nocturnes",
      series: null,
    });
  });

  it("treats a trailing parens with no number as a subtitle, not a series", () => {
    // Heuristic: only number-like trailing parens become series.
    // `(A Brief History)` reads as a subtitle and stays in the title.
    expect(cleanTitleAndSeries("Sapiens (A Brief History)")).toEqual({
      title: "Sapiens (A Brief History)",
      series: null,
    });
  });

  it("does treat any number-containing trailing parens as series (documented call)", () => {
    // Real-world Goodreads exports nearly always put a numbered series
    // in the trailing parens. The cost of this heuristic is that an
    // unrelated number in trailing parens — e.g. `(Limited Edition,
    // Vol. 2)` — also becomes the "series". The user corrects these
    // case-by-case in the vault rather than us trying to be clever.
    expect(cleanTitleAndSeries("Some Title (subtitle 2)")).toEqual({
      title: "Some Title",
      series: "subtitle 2",
    });
  });

  it("handles `(Series Name #N)` without the comma", () => {
    expect(cleanTitleAndSeries("Dune (Dune Chronicles #1)")).toEqual({
      title: "Dune",
      series: "Dune Chronicles #1",
    });
  });

  it("handles `Vol. N` style series markers (number-like, kept as-is)", () => {
    expect(cleanTitleAndSeries("Saga (Vol. 2)")).toEqual({
      title: "Saga",
      series: "Vol. 2",
    });
  });

  it("collapses whitespace inside the series field", () => {
    expect(cleanTitleAndSeries("Foo  (  Bar  Baz,  #3  )")).toEqual({
      title: "Foo",
      series: "Bar Baz #3",
    });
  });

  it("returns empty title and null series for empty input", () => {
    expect(cleanTitleAndSeries("")).toEqual({ title: "", series: null });
  });

  it("returns empty title and null series for whitespace-only input", () => {
    expect(cleanTitleAndSeries("   ")).toEqual({ title: "", series: null });
  });

  it("returns empty title and null series for null / undefined input", () => {
    // YAML can hand us nullish values when a CSV field was blank.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(cleanTitleAndSeries(null as any)).toEqual({ title: "", series: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(cleanTitleAndSeries(undefined as any)).toEqual({ title: "", series: null });
  });

  it("coerces numeric titles (YAML may parse `1984` to a number) to strings", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(cleanTitleAndSeries(1984 as any)).toEqual({ title: "1984", series: null });
  });
});
