import { describe, expect, it } from "vitest";
import { applyPatch, commitPatchInputSchema } from "../../src/lib/mcp/patch";
import { parseMarkdownFile } from "../../src/lib/markdown-sections";

const SAMPLE = `---
title: Test Book
authors: [Author One]
status: reading
progress: "Chapter 3"
rating: null
tags: [scifi]
---

## Synopsis

The first paragraph.

## Quotes

> "Original quote."
`;

describe("applyPatch — frontmatter changes", () => {
  it("updates a scalar field", () => {
    const result = applyPatch(SAMPLE, {
      frontmatter_changes: { status: "finished" },
    });
    const parsed = parseMarkdownFile(result.after);
    expect(parsed.frontmatter.status).toBe("finished");
    expect(result.changedFrontmatter).toContainEqual({
      key: "status",
      before: "reading",
      after: "finished",
    });
  });

  it("removes a key when the change value is null", () => {
    const result = applyPatch(SAMPLE, { frontmatter_changes: { progress: null } });
    const parsed = parseMarkdownFile(result.after);
    expect("progress" in parsed.frontmatter).toBe(false);
  });

  it("adds a key that wasn't present before", () => {
    const result = applyPatch(SAMPLE, {
      frontmatter_changes: { finished: "2026-05-05" },
    });
    const parsed = parseMarkdownFile(result.after);
    expect(parsed.frontmatter.finished).toBe("2026-05-05");
  });

  it("ignores a no-op change", () => {
    const result = applyPatch(SAMPLE, {
      frontmatter_changes: { status: "reading" }, // already "reading"
    });
    expect(result.changedFrontmatter).toEqual([]);
  });

  it("updates an array field", () => {
    const result = applyPatch(SAMPLE, {
      frontmatter_changes: { tags: ["scifi", "horror"] },
    });
    const parsed = parseMarkdownFile(result.after);
    expect(parsed.frontmatter.tags).toEqual(["scifi", "horror"]);
  });
});

describe("applyPatch — section changes", () => {
  it("replaces an existing section's content", () => {
    const result = applyPatch(SAMPLE, {
      section_changes: { Synopsis: { action: "replace", content: "A new synopsis." } },
    });
    const parsed = parseMarkdownFile(result.after);
    const synopsis = parsed.sections.find((s) => s.name === "Synopsis");
    expect(synopsis?.content).toContain("A new synopsis.");
    expect(synopsis?.content).not.toContain("first paragraph");
  });

  it("appends to an existing section", () => {
    const result = applyPatch(SAMPLE, {
      section_changes: { Quotes: { action: "append", content: '> "Another quote."' } },
    });
    const parsed = parseMarkdownFile(result.after);
    const quotes = parsed.sections.find((s) => s.name === "Quotes");
    expect(quotes?.content).toContain("Original quote");
    expect(quotes?.content).toContain("Another quote");
  });

  it("prepends to an existing section", () => {
    const result = applyPatch(SAMPLE, {
      section_changes: { Quotes: { action: "prepend", content: '> "Earliest."' } },
    });
    const parsed = parseMarkdownFile(result.after);
    const quotes = parsed.sections.find((s) => s.name === "Quotes");
    const idxEarly = (quotes?.content ?? "").indexOf("Earliest");
    const idxOriginal = (quotes?.content ?? "").indexOf("Original quote");
    expect(idxEarly).toBeGreaterThanOrEqual(0);
    expect(idxEarly).toBeLessThan(idxOriginal);
  });

  it("creates a new section when appending to a non-existent name", () => {
    const result = applyPatch(SAMPLE, {
      section_changes: { Notes: { action: "append", content: "Some notes." } },
    });
    const parsed = parseMarkdownFile(result.after);
    expect(parsed.sections.map((s) => s.name)).toContain("Notes");
  });

  it("refuses to replace a section that doesn't exist", () => {
    expect(() =>
      applyPatch(SAMPLE, {
        section_changes: { Nonexistent: { action: "replace", content: "x" } },
      }),
    ).toThrow(/does not exist/);
  });
});

describe("commitPatchInputSchema", () => {
  it("accepts a well-formed patch", () => {
    const valid = {
      slug: "TestBook",
      frontmatter_changes: { status: "finished" },
      section_changes: { Review: { action: "append", content: "Loved it." } },
      commit_message: "Finished TestBook",
    };
    expect(() => commitPatchInputSchema.parse(valid)).not.toThrow();
  });

  it("rejects an invalid section action", () => {
    const invalid = {
      slug: "x",
      section_changes: { Review: { action: "delete", content: "x" } },
      commit_message: "x",
    };
    expect(() => commitPatchInputSchema.parse(invalid)).toThrow();
  });

  it("rejects a missing slug", () => {
    expect(() => commitPatchInputSchema.parse({ commit_message: "x" })).toThrow();
  });
});
