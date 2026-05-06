import { describe, expect, it } from "vitest";
import { parseMarkdownFile, serialiseMarkdownFile } from "../../src/lib/markdown-sections";

const SAMPLE = `---
title: Test Book
authors: [Author One]
status: finished
rating: 4.5
tags: [scifi, mystery]
---

A short lead paragraph that sits before any section heading.

## Synopsis

A book about something. With a couple of paragraphs.

The second paragraph.

## Quotes

> "A line that stuck."

— Ch. 5

## Review

I liked it.
`;

describe("parseMarkdownFile", () => {
  it("parses frontmatter into a record", () => {
    const parsed = parseMarkdownFile(SAMPLE);
    expect(parsed.frontmatter.title).toBe("Test Book");
    expect(parsed.frontmatter.authors).toEqual(["Author One"]);
    expect(parsed.frontmatter.tags).toEqual(["scifi", "mystery"]);
  });

  it("captures the lead paragraph before the first H2", () => {
    const parsed = parseMarkdownFile(SAMPLE);
    expect(parsed.lead).toContain("A short lead paragraph");
  });

  it("splits the body by H2 in order", () => {
    const parsed = parseMarkdownFile(SAMPLE);
    expect(parsed.sections.map((s) => s.name)).toEqual(["Synopsis", "Quotes", "Review"]);
    expect(parsed.sections[0].content).toContain("A book about something");
    expect(parsed.sections[1].content).toContain("A line that stuck");
  });

  it("handles a file with no body", () => {
    const parsed = parseMarkdownFile(`---\ntitle: x\n---\n`);
    expect(parsed.frontmatter.title).toBe("x");
    expect(parsed.lead).toBe("");
    expect(parsed.sections).toEqual([]);
  });

  it("handles a file with no sections, only lead", () => {
    const parsed = parseMarkdownFile(`---\ntitle: x\n---\n\nJust a paragraph.\n`);
    expect(parsed.lead).toBe("Just a paragraph.");
    expect(parsed.sections).toEqual([]);
  });
});

describe("serialiseMarkdownFile", () => {
  it("round-trips an unchanged file with stable frontmatter", () => {
    const parsed = parseMarkdownFile(SAMPLE);
    const out = serialiseMarkdownFile(parsed);
    // Reparse and compare semantic shape — exact byte equality is not
    // a goal (newline tweaks happen) but every field + section must
    // survive.
    const reparsed = parseMarkdownFile(out);
    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.sections.map((s) => s.name)).toEqual(parsed.sections.map((s) => s.name));
  });

  it("re-emits frontmatter when a key changed", () => {
    const parsed = parseMarkdownFile(SAMPLE);
    parsed.frontmatter.rating = 5;
    parsed.frontmatterRaw = ""; // signal that re-emit is required
    const out = serialiseMarkdownFile(parsed);
    expect(out).toContain("rating: 5");
  });
});
