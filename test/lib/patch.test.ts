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

  it("bundles a finish flip with pullquote + rating in a single patch", () => {
    // The finish-flow gate (admin agent) requires the agent to ask the
    // user for a pullquote and rating before allowing status to flip to
    // finished, then bundle all three changes into ONE propose_patch
    // call. Pins that applyPatch handles that bundle as a single
    // changeset and the resulting frontmatter carries every field.
    const result = applyPatch(SAMPLE, {
      frontmatter_changes: {
        status: "finished",
        rating: 5,
        pullquote: "A man lives in a house of statues.",
        finished: "2026-05-09",
      },
    });
    const parsed = parseMarkdownFile(result.after);
    expect(parsed.frontmatter.status).toBe("finished");
    expect(parsed.frontmatter.rating).toBe(5);
    expect(parsed.frontmatter.pullquote).toBe("A man lives in a house of statues.");
    expect(parsed.frontmatter.finished).toBe("2026-05-09");
    // Every key shows up in the changedFrontmatter audit so the diff
    // preview can render them. status moved from reading → finished;
    // rating was null and is now 5; pullquote + finished are brand-new.
    const changedKeys = result.changedFrontmatter.map((c) => c.key).sort();
    expect(changedKeys).toEqual(["finished", "pullquote", "rating", "status"]);
  });
});

describe("applyPatch — frontmatter fidelity (surgical edits)", () => {
  // The earlier impl re-serialised the whole frontmatter on any
  // change, churning key order / quoting on unrelated keys. The
  // surgical pass only touches the changed key's line(s).

  const FIDELITY_SAMPLE = `---
title: "Piranesi"
authors: [Susanna Clarke]
status: finished
finished: 2026-04-12
rating: 5
tags: [literary, fantasy]
goodreads_id: "50202953"
---

## Synopsis

A man lives in a house of statues.
`;

  it("changing one key leaves every other key's exact line untouched", () => {
    const result = applyPatch(FIDELITY_SAMPLE, {
      frontmatter_changes: { tags: ["literary", "fantasy", "atmospheric"] },
    });
    // Every line that was NOT `tags:` must appear verbatim.
    const before = FIDELITY_SAMPLE.split("\n");
    const after = result.after.split("\n");
    for (const line of before) {
      if (line.startsWith("tags:")) continue;
      expect(after).toContain(line);
    }
  });

  it("preserves unrelated keys' quoting style", () => {
    const result = applyPatch(FIDELITY_SAMPLE, {
      frontmatter_changes: { rating: 4 },
    });
    // The originally-quoted goodreads_id stays quoted; the
    // originally-unquoted authors stay unquoted.
    expect(result.after).toContain('goodreads_id: "50202953"');
    expect(result.after).toContain("authors: [Susanna Clarke]");
    expect(result.after).toContain('title: "Piranesi"');
  });

  it("removing a key only deletes that one line", () => {
    const result = applyPatch(FIDELITY_SAMPLE, {
      frontmatter_changes: { goodreads_id: null },
    });
    const before = FIDELITY_SAMPLE.split("\n");
    const after = result.after.split("\n");
    expect(after).not.toContain('goodreads_id: "50202953"');
    // Every other line preserved.
    for (const line of before) {
      if (line.startsWith("goodreads_id:")) continue;
      expect(after).toContain(line);
    }
  });

  it("converts a block-style array to inline flow when that array is changed", () => {
    const blockStyleSample = `---
title: Test
tags:
  - scifi
  - fantasy
status: tbr
---

## Body
`;
    const result = applyPatch(blockStyleSample, {
      frontmatter_changes: { tags: ["scifi", "fantasy", "ya"] },
    });
    expect(result.after).toContain("tags: [scifi, fantasy, ya]");
    expect(result.after).not.toContain("- scifi");
    // Status untouched.
    expect(result.after).toContain("status: tbr");
  });

  it("adds a brand-new key adjacent to the existing block", () => {
    const result = applyPatch(FIDELITY_SAMPLE, {
      frontmatter_changes: { hardcover_slug: "piranesi" },
    });
    expect(result.after).toContain("hardcover_slug: piranesi");
    // Existing keys still in their original positions.
    expect(result.after).toContain('title: "Piranesi"');
    expect(result.after).toContain("rating: 5");
  });

  it("quotes string values that contain YAML-special characters", () => {
    const result = applyPatch(FIDELITY_SAMPLE, {
      frontmatter_changes: { title: "A Title: With Colons" },
    });
    expect(result.after).toContain('title: "A Title: With Colons"');
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
