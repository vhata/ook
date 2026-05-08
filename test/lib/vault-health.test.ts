import { describe, expect, it } from "vitest";
import { checkBook } from "../../src/lib/vault-health";
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
