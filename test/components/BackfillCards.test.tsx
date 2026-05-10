// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildPatch, canAnswer } from "../../src/components/admin/BackfillCards";
import type { BackfillQuestion } from "../../src/lib/admin/backfill";

function q(kind: "rate" | "review" | "wouldReread"): BackfillQuestion {
  return {
    kind,
    bookSlug: "test-book",
    bookTitle: "Test Book",
    bookAuthors: ["Author"],
    bookCover: null,
    prompt: "test prompt",
  };
}

describe("canAnswer", () => {
  it("requires a numeric rating for rate questions", () => {
    expect(canAnswer(q("rate"), {})).toBe(false);
    expect(canAnswer(q("rate"), { rating: 4 })).toBe(true);
  });

  it("requires non-empty trimmed review text for review questions", () => {
    expect(canAnswer(q("review"), {})).toBe(false);
    expect(canAnswer(q("review"), { reviewText: "" })).toBe(false);
    expect(canAnswer(q("review"), { reviewText: "   " })).toBe(false);
    expect(canAnswer(q("review"), { reviewText: "Loved it." })).toBe(true);
  });

  it("requires a boolean wouldReread for wouldReread questions", () => {
    expect(canAnswer(q("wouldReread"), {})).toBe(false);
    expect(canAnswer(q("wouldReread"), { wouldReread: true })).toBe(true);
    expect(canAnswer(q("wouldReread"), { wouldReread: false })).toBe(true);
  });
});

describe("buildPatch", () => {
  it("builds a frontmatter rating patch for rate questions", () => {
    const patch = buildPatch(q("rate"), { rating: 5 });
    expect(patch).toEqual({
      slug: "test-book",
      frontmatter_changes: { rating: 5 },
      commit_message: "Set rating to 5 for Test Book",
    });
  });

  it("builds a would_reread frontmatter patch for wouldReread questions", () => {
    const patch = buildPatch(q("wouldReread"), { wouldReread: true });
    expect(patch).toEqual({
      slug: "test-book",
      frontmatter_changes: { would_reread: true },
      commit_message: "Mark would_reread=true for Test Book",
    });
  });

  it("builds a file-backed review section patch for review questions", () => {
    const patch = buildPatch(q("review"), { reviewText: "Loved the prose." });
    expect(patch).toEqual({
      slug: "test-book",
      section_changes: {
        review: { action: "replace", content: "Loved the prose.\n" },
      },
      commit_message: "Add a short review for Test Book",
    });
  });

  it("trims surrounding whitespace from the review body", () => {
    const patch = buildPatch(q("review"), { reviewText: "   \n  Loved it.  \n" });
    expect(patch?.section_changes?.review.content).toBe("Loved it.\n");
  });

  it("returns null when the answer is missing", () => {
    expect(buildPatch(q("rate"), undefined)).toBeNull();
    expect(buildPatch(q("rate"), {})).toBeNull();
    expect(buildPatch(q("review"), { reviewText: "" })).toBeNull();
    expect(buildPatch(q("wouldReread"), {})).toBeNull();
  });
});
