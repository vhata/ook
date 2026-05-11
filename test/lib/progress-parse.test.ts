import { describe, expect, it } from "vitest";
import { parseProgress } from "../../src/lib/progress-parse";

describe("parseProgress — percent", () => {
  it("parses a bare `47%`", () => {
    expect(parseProgress("47%")).toEqual({ percent: 47, source: "percent" });
  });

  it("parses with a space before the symbol", () => {
    expect(parseProgress("47 %")).toEqual({ percent: 47, source: "percent" });
  });

  it("clamps over-100 to 100", () => {
    expect(parseProgress("150%")?.percent).toBe(100);
  });

  it("works inside a longer prose string", () => {
    expect(parseProgress("around 60% through the second act")).toEqual({
      percent: 60,
      source: "percent",
    });
  });
});

describe("parseProgress — fraction", () => {
  it("parses `N of M`", () => {
    expect(parseProgress("page 142 of 350")).toEqual({ percent: 41, source: "fraction" });
  });

  it("parses `N/M`", () => {
    expect(parseProgress("5/12")).toEqual({ percent: 42, source: "fraction" });
  });

  it("rejects a degenerate denominator", () => {
    expect(parseProgress("5 of 0")).toBeNull();
  });

  it("doesn't misfire on a date-like substring", () => {
    expect(parseProgress("started 2026-05-11")).toBeNull();
  });
});

describe("parseProgress — page", () => {
  it("uses totalPages context to convert `p. 142` to a percent", () => {
    expect(parseProgress("p. 142", 350)).toEqual({ percent: 41, source: "page" });
  });

  it("accepts `page 142` and `pages 142` shapes", () => {
    expect(parseProgress("page 142", 350)?.percent).toBe(41);
    expect(parseProgress("on pages 142 today", 350)?.percent).toBe(41);
  });

  it("returns null when totalPages is missing", () => {
    expect(parseProgress("p. 142")).toBeNull();
  });

  it("clamps past-end pages to 100", () => {
    expect(parseProgress("p. 400", 350)?.percent).toBe(100);
  });
});

describe("parseProgress — chapter", () => {
  it("parses `chapter 5 of 20`", () => {
    expect(parseProgress("chapter 5 of 20")).toEqual({ percent: 25, source: "chapter" });
  });

  it("parses `ch. 5 of 20`", () => {
    expect(parseProgress("ch. 5 of 20")).toEqual({ percent: 25, source: "chapter" });
  });

  it("returns null when no `of N` is present", () => {
    // "chapter 5" alone gives no denominator; without one we can't
    // estimate a percent.
    expect(parseProgress("chapter 5")).toBeNull();
  });
});

describe("parseProgress — non-matches", () => {
  it("returns null for empty string", () => {
    expect(parseProgress("")).toBeNull();
  });

  it("returns null for whitespace-only", () => {
    expect(parseProgress("   \t  ")).toBeNull();
  });

  it("returns null for unparseable prose", () => {
    expect(parseProgress("just started this one")).toBeNull();
  });
});

describe("parseProgress — priority", () => {
  it("prefers explicit `%` over a fraction also present in the string", () => {
    // "20%" should win even though "10 of 50" is also extractable.
    expect(parseProgress("20% — about 10 of 50")?.source).toBe("percent");
  });

  it("prefers a fraction over a page+totalPages match", () => {
    // "100 of 200" is more direct than "p. 142 + total".
    expect(parseProgress("100 of 200, around p. 142", 350)?.source).toBe("fraction");
  });
});
