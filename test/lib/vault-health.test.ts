import { describe, expect, it } from "vitest";
import { checkBook, checkCorpus } from "../../src/lib/vault-health";
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
    cover: "https://example.com/c.jpg",
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

describe("checkBook", () => {
  const slugs = new Set(["x", "other"]);

  it("warns when authors is empty", () => {
    const findings = checkBook(book({ authors: [] }), slugs);
    const f = findings.find((x) => x.field === "authors");
    expect(f?.severity).toBe("warning");
  });

  it("warns when status=finished but no finished date", () => {
    const findings = checkBook(book({ status: "finished" }), slugs);
    expect(findings.some((f) => f.field === "finished" && f.severity === "warning")).toBe(true);
  });

  it("infos when finished but no rating", () => {
    const findings = checkBook(
      book({ status: "finished", finished: "2026-01-01", rating: null }),
      slugs,
    );
    expect(findings.some((f) => f.field === "rating" && f.severity === "info")).toBe(true);
  });

  it("warns when status=reading but no started date", () => {
    const findings = checkBook(book({ status: "reading" }), slugs);
    expect(findings.some((f) => f.field === "started" && f.severity === "warning")).toBe(true);
  });

  it("infos when no cover URL is present", () => {
    const findings = checkBook(book({ cover: null }), slugs);
    expect(findings.some((f) => f.field === "cover" && f.severity === "info")).toBe(true);
  });

  it("errors on broken see_also references", () => {
    const findings = checkBook(book({ seeAlso: ["other", "missing"] }), slugs);
    const f = findings.find((x) => x.field === "see_also" && x.severity === "error");
    expect(f?.message).toContain("missing");
  });

  it("returns no findings for a fully-fleshed finished book", () => {
    const findings = checkBook(
      book({
        status: "finished",
        finished: "2026-01-01",
        rating: 4,
        hasReview: true,
        cover: "https://example.com/c.jpg",
      }),
      slugs,
    );
    expect(findings).toEqual([]);
  });
});

describe("checkCorpus", () => {
  it("flags an orphan when nothing references the book and no bingo binding", () => {
    const a = book({ slug: "a", title: "A" });
    const findings = checkCorpus([a]);
    const orphan = findings.find((f) => f.slug === "a" && f.field === "orphan");
    expect(orphan?.severity).toBe("info");
  });

  it("does NOT flag an orphan when something references the book", () => {
    const a = book({ slug: "a", seeAlso: ["b"] });
    const b = book({ slug: "b" });
    const findings = checkCorpus([a, b]);
    expect(findings.some((f) => f.slug === "b" && f.field === "orphan")).toBe(false);
  });

  it("does NOT flag an orphan when the book has bingo bindings", () => {
    const a = book({ slug: "a", bingoSquares: ["A1"] });
    const findings = checkCorpus([a]);
    expect(findings.some((f) => f.slug === "a" && f.field === "orphan")).toBe(false);
  });

  it("flags asymmetric see_also when one side links and the other doesn't", () => {
    const a = book({ slug: "a", seeAlso: ["b"] });
    const b = book({ slug: "b", seeAlso: [] });
    const findings = checkCorpus([a, b]);
    const asym = findings.find(
      (f) => f.slug === "b" && f.field === "see_also" && f.message.includes("Asymmetric"),
    );
    expect(asym?.severity).toBe("info");
  });

  it("does NOT flag asymmetric see_also when both sides link", () => {
    const a = book({ slug: "a", seeAlso: ["b"] });
    const b = book({ slug: "b", seeAlso: ["a"] });
    const findings = checkCorpus([a, b]);
    expect(findings.some((f) => f.field === "see_also" && f.message.includes("Asymmetric"))).toBe(
      false,
    );
  });
});
