// Pins behaviour of the Bookcision JSON importer's pure helpers:
// parsing the upstream `{ asin, title, authors, highlights }` shape;
// per-highlight dedupe via the stable hash; ASIN-first / title-fallback
// matching; quotes.md formatting; idempotency-state read/write; and the
// "second run produces zero diff" property the script wrapper relies on.
//
// The script wrapper around these helpers does the IO; everything
// testable lives in the lib so the tests don't have to spin up the
// filesystem.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs lib lives outside the TS project graph
import {
  KINDLE_HIGHLIGHTS_HEADING,
  appendHighlights,
  buildStateEntry,
  decideStateWrite,
  extractExistingHashes,
  hashHighlight,
  isStateNoOp,
  matchBookcisionToVault,
  parseBookcision,
  renderAttribution,
  renderHighlight,
  stableStringify,
} from "../../scripts/lib/bookcision.mjs";

const SAMPLE: unknown = {
  asin: "B00AA36R4U",
  title: "Piranesi",
  authors: "Susanna Clarke",
  highlights: [
    {
      text: "The Beauty of the House is immeasurable; its Kindness infinite.",
      isNoteOnly: false,
      location: { url: "https://read.amazon.com/?asin=B00AA36R4U&location=132", value: 132 },
    },
    {
      text: "I am the Beloved Child of the House.",
      isNoteOnly: false,
      location: { url: "https://read.amazon.com/?asin=B00AA36R4U&location=240", value: 240 },
      note: "compare to ch. 3 ritual",
    },
    {
      text: "This is a freestanding reader note.",
      isNoteOnly: true,
      location: { url: "https://read.amazon.com/?asin=B00AA36R4U&location=300", value: 300 },
    },
  ],
};

describe("parseBookcision", () => {
  it("parses the upstream schema and emits typed highlights", () => {
    const parsed = parseBookcision(SAMPLE);
    expect(parsed.asin).toBe("B00AA36R4U");
    expect(parsed.title).toBe("Piranesi");
    expect(parsed.authors).toBe("Susanna Clarke");
    expect(parsed.highlights).toHaveLength(3);

    const [first, second, third] = parsed.highlights;
    expect(first.isNoteOnly).toBe(false);
    expect(first.location).toBe(132);
    expect(first.note).toBeNull();
    expect(typeof first.hash).toBe("string");
    expect(first.hash).toHaveLength(16);

    expect(second.note).toBe("compare to ch. 3 ritual");
    expect(second.location).toBe(240);

    expect(third.isNoteOnly).toBe(true);
    expect(third.location).toBe(300);
  });

  it("tolerates missing optional fields (asin, authors, note, location)", () => {
    const parsed = parseBookcision({
      title: "Minimal Book",
      highlights: [{ text: "bare highlight", isNoteOnly: false, location: {} }],
    });
    expect(parsed.asin).toBeNull();
    expect(parsed.authors).toBeNull();
    expect(parsed.highlights[0].location).toBeNull();
    expect(parsed.highlights[0].note).toBeNull();
  });

  it("drops highlights with empty / non-string text", () => {
    const parsed = parseBookcision({
      title: "Mixed",
      highlights: [
        { text: "keep me", isNoteOnly: false, location: { value: 1 } },
        { text: "   ", isNoteOnly: false, location: { value: 2 } },
        { text: 99, isNoteOnly: false, location: { value: 3 } },
      ],
    });
    expect(parsed.highlights).toHaveLength(1);
    expect(parsed.highlights[0].text).toBe("keep me");
  });

  it("throws on payloads missing title or highlights", () => {
    expect(() => parseBookcision({})).toThrow(/title/);
    expect(() => parseBookcision({ title: "X" })).toThrow(/highlights/);
    expect(() => parseBookcision(null)).toThrow();
  });

  it("coerces a stringified location.value", () => {
    const parsed = parseBookcision({
      title: "Stringy",
      highlights: [{ text: "x", isNoteOnly: false, location: { value: "456" } }],
    });
    expect(parsed.highlights[0].location).toBe(456);
  });
});

describe("hashHighlight", () => {
  it("collapses whitespace differences in body text", () => {
    const a = hashHighlight({ text: "hello\n world", isNoteOnly: false, note: null });
    const b = hashHighlight({ text: "hello   world", isNoteOnly: false, note: null });
    expect(a).toBe(b);
  });

  it("differs by kind (note-only vs highlight)", () => {
    const a = hashHighlight({ text: "same body", isNoteOnly: false, note: null });
    const b = hashHighlight({ text: "same body", isNoteOnly: true, note: null });
    expect(a).not.toBe(b);
  });

  it("differs when a note is attached vs absent", () => {
    const a = hashHighlight({ text: "body", isNoteOnly: false, note: null });
    const b = hashHighlight({ text: "body", isNoteOnly: false, note: "a thought" });
    expect(a).not.toBe(b);
  });
});

describe("matchBookcisionToVault", () => {
  const vault = [
    { slug: "piranesi", title: "Piranesi", asin: "B00AA36R4U" },
    { slug: "cryptonomicon", title: "Cryptonomicon", asin: null },
    { slug: "lotr", title: "The Lord of the Rings", asin: null },
    { slug: "the-fifth-season", title: "The Fifth Season", asin: null },
  ];

  it("matches by ASIN when both sides carry one", () => {
    const parsed = parseBookcision(SAMPLE);
    expect(matchBookcisionToVault(parsed, vault)).toEqual({
      slug: "piranesi",
      via: "asin",
    });
  });

  it("falls back to exact title match when ASIN is missing", () => {
    const parsed = parseBookcision({
      title: "Cryptonomicon",
      highlights: [{ text: "x", isNoteOnly: false, location: { value: 1 } }],
    });
    expect(matchBookcisionToVault(parsed, vault)).toEqual({
      slug: "cryptonomicon",
      via: "title-exact",
    });
  });

  it("falls back to substring title match for subtitle drift", () => {
    const parsed = parseBookcision({
      title: "Cryptonomicon: The Cryptography Novel",
      highlights: [{ text: "x", isNoteOnly: false, location: { value: 1 } }],
    });
    expect(matchBookcisionToVault(parsed, vault)?.slug).toBe("cryptonomicon");
    expect(matchBookcisionToVault(parsed, vault)?.via).toBe("title-substring");
  });

  it("prefers ASIN over a fuzzy-title hit", () => {
    // ASIN belongs to piranesi; title says cryptonomicon — ASIN wins.
    const parsed = parseBookcision({
      asin: "B00AA36R4U",
      title: "Cryptonomicon",
      highlights: [{ text: "x", isNoteOnly: false, location: { value: 1 } }],
    });
    expect(matchBookcisionToVault(parsed, vault)?.slug).toBe("piranesi");
  });

  it("returns null on no plausible match", () => {
    const parsed = parseBookcision({
      title: "An Unknown Book Not In The Vault",
      highlights: [{ text: "x", isNoteOnly: false, location: { value: 1 } }],
    });
    expect(matchBookcisionToVault(parsed, vault)).toBeNull();
  });

  it("rejects short common substrings", () => {
    const parsed = parseBookcision({
      title: "It",
      highlights: [{ text: "x", isNoteOnly: false, location: { value: 1 } }],
    });
    expect(matchBookcisionToVault(parsed, vault)).toBeNull();
  });
});

describe("renderHighlight / renderAttribution", () => {
  it("renders a blockquote with a Location attribution and the dedupe hash", () => {
    const parsed = parseBookcision(SAMPLE);
    const rendered = renderHighlight(parsed.highlights[0]);
    expect(rendered).toContain("> The Beauty of the House");
    expect(rendered).toContain("*— Location 132*");
    expect(rendered).toMatch(/<!-- bookcision-hash:[0-9a-f]+ -->/);
    expect(extractExistingHashes(rendered).has(parsed.highlights[0].hash)).toBe(true);
  });

  it("falls back to 'from Kindle' when location is missing", () => {
    expect(
      renderAttribution({
        text: "x",
        isNoteOnly: false,
        location: null,
        url: null,
        note: null,
        hash: "",
      }),
    ).toBe("from Kindle");
  });

  it("renders a standalone reader note differently from a highlight", () => {
    const parsed = parseBookcision(SAMPLE);
    const noteOnly = parsed.highlights[2];
    const rendered = renderHighlight(noteOnly);
    expect(rendered).toContain("> *Note:* This is a freestanding reader note.");
  });

  it("renders an attached reader note under the highlight", () => {
    const parsed = parseBookcision(SAMPLE);
    const annotated = parsed.highlights[1];
    const rendered = renderHighlight(annotated);
    expect(rendered).toContain("> — compare to ch. 3 ritual");
  });
});

describe("appendHighlights", () => {
  const parsed = parseBookcision(SAMPLE);
  const fresh = parsed.highlights;

  it("creates a fresh `## From Kindle highlights` heading when quotes.md is empty", () => {
    const { next, written } = appendHighlights("", fresh);
    expect(written).toHaveLength(3);
    expect(next).toContain(KINDLE_HIGHLIGHTS_HEADING);
    expect(next).toContain("The Beauty of the House");
    expect(next).toContain("Beloved Child");
    expect(next).toContain("freestanding reader note");
  });

  it("produces a byte-identical file on a second run with the same input", () => {
    const first = appendHighlights("", fresh);
    const second = appendHighlights(first.next, fresh);
    expect(second.written).toEqual([]);
    expect(second.next).toBe(first.next);
  });

  it("appends new entries into the existing section on a third run", () => {
    const first = appendHighlights("", fresh.slice(0, 1));
    const second = appendHighlights(first.next, fresh.slice(1));
    expect(second.written).toHaveLength(2);
    // One — and only one — heading regardless of how many runs we make.
    const headingCount = (second.next.match(/^## From Kindle highlights\s*$/gm) || []).length;
    expect(headingCount).toBe(1);
    expect(second.next).toContain("Beauty of the House");
    expect(second.next).toContain("Beloved Child");
  });

  it("preserves a hand-written section ahead of the Kindle block", () => {
    const existing = ["## Favourites", "", "> A hand-picked quote.", "", "*— page 7*", ""].join(
      "\n",
    );
    const { next } = appendHighlights(existing, fresh);
    expect(next).toContain("## Favourites");
    expect(next).toContain("A hand-picked quote.");
    expect(next).toContain(KINDLE_HIGHLIGHTS_HEADING);
    expect(next.indexOf("## Favourites")).toBeLessThan(next.indexOf(KINDLE_HIGHLIGHTS_HEADING));
  });
});

describe("buildStateEntry / isStateNoOp", () => {
  it("computes a stable digest that survives JSON key reordering", () => {
    const parsedA = parseBookcision(SAMPLE);
    // Stringify-and-reparse so the in-memory object's key insertion
    // order is reset; the digest must still match.
    const parsedB = parseBookcision(JSON.parse(JSON.stringify(SAMPLE)));
    const a = buildStateEntry("piranesi", parsedA, parsedA.highlights);
    const b = buildStateEntry("piranesi", parsedB, parsedB.highlights);
    expect(a.sourceDigest).toBe(b.sourceDigest);
  });

  it("treats a re-export with extra highlights as a non-no-op", () => {
    const parsed = parseBookcision(SAMPLE);
    const previous = buildStateEntry("piranesi", parsed, parsed.highlights);
    expect(isStateNoOp(previous, parsed)).toBe(true);

    // Add one more highlight to simulate a re-export from Bookcision.
    const grown = parseBookcision({
      ...(SAMPLE as object),
      highlights: [
        ...(SAMPLE as { highlights: unknown[] }).highlights,
        {
          text: "An eleventh-hour insight.",
          isNoteOnly: false,
          location: { value: 420 },
        },
      ],
    });
    expect(isStateNoOp(previous, grown)).toBe(false);
  });

  it("returns false when there's no prior entry", () => {
    const parsed = parseBookcision(SAMPLE);
    expect(isStateNoOp(null, parsed)).toBe(false);
    expect(isStateNoOp(undefined, parsed)).toBe(false);
    expect(isStateNoOp({}, parsed)).toBe(false);
  });
});

describe("stableStringify", () => {
  it("sorts keys deterministically at every depth", () => {
    const a = { b: 1, a: 2, nested: { y: 1, x: 2 } };
    const b = { a: 2, nested: { x: 2, y: 1 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

describe("decideStateWrite", () => {
  it("skips writing when entries are unchanged", () => {
    const entries = {
      "/abs/path/a.json": { slug: "s", sourceDigest: "abc", hashes: [], highlightCount: 0 },
    };
    const existing = { entries, updated: "2026-05-01T00:00:00Z", generator: "x" };
    const verdict = decideStateWrite({
      newEntries: entries,
      existing,
      generator: "x",
      now: () => "2026-05-02T00:00:00Z",
    });
    expect(verdict.write).toBe(false);
  });

  it("writes when entries differ, with a deterministic top-level shape", () => {
    const verdict = decideStateWrite({
      newEntries: {
        "/abs/a.json": { slug: "s", sourceDigest: "d", hashes: ["h"], highlightCount: 1 },
      },
      existing: null,
      generator: "scripts/import-bookcision.mjs",
      now: () => "2026-05-02T00:00:00Z",
    });
    expect(verdict.write).toBe(true);
    if (verdict.write) {
      const parsed = JSON.parse(verdict.contents);
      expect(parsed.generator).toBe("scripts/import-bookcision.mjs");
      expect(parsed.updated).toBe("2026-05-02T00:00:00Z");
      expect(parsed.entries["/abs/a.json"].sourceDigest).toBe("d");
    }
  });
});
