import { describe, expect, it } from "vitest";
import { getSchemaSummary } from "../../src/lib/schema";
import type { Book } from "../../src/lib/types";

function book(overrides: Partial<Book> = {}): Book {
  return {
    slug: "x",
    title: "x",
    authors: ["A"],
    series: null,
    status: "tbr",
    progress: "",
    started: null,
    finished: null,
    rating: null,
    wouldReread: null,
    bingoSquares: [],
    tags: [],
    cover: null,
    pullquote: null,
    seeAlso: [],
    lastEdited: null,
    hasReview: false,
    hasQuotes: false,
    hasSummary: false,
    goodreadsId: null,
    hardcoverSlug: null,
    storygraphSlug: null,
    bookwyrmUrl: null,
    source: null,
    hideExternalReviews: false,
    ...overrides,
  };
}

describe("getSchemaSummary", () => {
  it("returns one entry per known field with the corpus total stamped on each", () => {
    const summary = getSchemaSummary([book()]);
    expect(summary.total).toBe(1);
    const titleField = summary.fields.find((f) => f.name === "title");
    expect(titleField).toBeTruthy();
    expect(titleField!.total).toBe(1);
  });

  it("counts populated string fields and reports examples", () => {
    const summary = getSchemaSummary([
      book({ series: "Cradle" }),
      book({ slug: "y", title: "y", series: "Stormlight" }),
      book({ slug: "z", title: "z", series: null }),
    ]);
    const series = summary.fields.find((f) => f.name === "series")!;
    expect(series.populated).toBe(2);
    expect(series.examples).toContain("Cradle");
    expect(series.examples).toContain("Stormlight");
  });

  it("treats empty arrays as unpopulated", () => {
    const summary = getSchemaSummary([book({ tags: [] }), book({ slug: "y", tags: ["scifi"] })]);
    const tags = summary.fields.find((f) => f.name === "tags")!;
    expect(tags.populated).toBe(1);
    expect(tags.examples).toContain("scifi");
  });

  it("treats wouldReread=null as unpopulated, true OR false as populated", () => {
    const summary = getSchemaSummary([
      book({ wouldReread: true }),
      book({ slug: "y", wouldReread: false }),
      book({ slug: "z", wouldReread: null }),
    ]);
    const wr = summary.fields.find((f) => f.name === "wouldReread")!;
    expect(wr.populated).toBe(2);
  });

  it("treats hasReview/hasQuotes/hasSummary as populated only when true", () => {
    const summary = getSchemaSummary([
      book({ hasReview: false }),
      book({ slug: "y", hasReview: true }),
    ]);
    const review = summary.fields.find((f) => f.name === "review.md")!;
    expect(review.populated).toBe(1);
  });

  it("sorts fields by coverage descending", () => {
    const summary = getSchemaSummary([book(), book({ slug: "y" })]);
    // title is 100%, cover is 0% — title must rank above cover.
    const titleIdx = summary.fields.findIndex((f) => f.name === "title");
    const coverIdx = summary.fields.findIndex((f) => f.name === "cover");
    expect(titleIdx).toBeLessThan(coverIdx);
  });

  it("truncates long example values with an ellipsis", () => {
    const long = "a".repeat(120);
    const summary = getSchemaSummary([book({ series: long })]);
    const series = summary.fields.find((f) => f.name === "series")!;
    expect(series.examples[0].length).toBeLessThanOrEqual(60);
    expect(series.examples[0].endsWith("…")).toBe(true);
  });
});
