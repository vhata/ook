import { describe, expect, it } from "vitest";
import { extractHeadings, slugify } from "../../src/lib/markdown";

describe("slugify", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("The Will of the Many")).toBe("the-will-of-the-many");
  });

  it("strips punctuation but keeps word characters", () => {
    expect(slugify("It's a Wonderful Life!")).toBe("its-a-wonderful-life");
  });

  it("trims leading and trailing whitespace", () => {
    expect(slugify("  Piranesi  ")).toBe("piranesi");
  });

  it("collapses multiple spaces into a single dash", () => {
    expect(slugify("Two   spaces")).toBe("two-spaces");
  });

  it("preserves existing dashes", () => {
    expect(slugify("hard-scifi")).toBe("hard-scifi");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(slugify("   ")).toBe("");
  });
});

describe("extractHeadings", () => {
  it("pulls H2 headings only — skips H1 and H3", () => {
    const body = ["# Big title", "## Section A", "### Subsection", "## Section B"].join("\n");
    expect(extractHeadings(body)).toEqual([
      { text: "Section A", slug: "section-a" },
      { text: "Section B", slug: "section-b" },
    ]);
  });

  it("trims trailing whitespace on the heading text", () => {
    expect(extractHeadings("## Spaced out   ")).toEqual([
      { text: "Spaced out", slug: "spaced-out" },
    ]);
  });

  it("returns an empty array when there are no H2 headings", () => {
    expect(extractHeadings("Just a paragraph.")).toEqual([]);
    expect(extractHeadings("# Only an H1")).toEqual([]);
  });

  it("preserves heading order", () => {
    const body = "## First\nstuff\n## Second\nmore stuff\n## Third";
    expect(extractHeadings(body).map((h) => h.text)).toEqual(["First", "Second", "Third"]);
  });

  it("handles punctuation in the heading text via slugify", () => {
    const body = "## Reading: notes & quotes!";
    expect(extractHeadings(body)).toEqual([
      { text: "Reading: notes & quotes!", slug: "reading-notes-quotes" },
    ]);
  });
});
