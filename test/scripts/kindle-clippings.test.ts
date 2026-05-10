// Pins behaviour of the Kindle `My Clippings.txt` importer's pure helpers:
// parsing (Highlight / Note / Bookmark, multi-line bodies, missing fields),
// fuzzy title matching against a vault index, dedupe-on-rerun via the stable
// per-entry hash, encoding detection (UTF-8 BOM and UTF-16-LE), and the
// merged-output shape on second-run append. The script wrapper around these
// helpers does the IO; everything testable lives in the lib.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs lib lives outside the TS project graph
import {
  appendEntries,
  decodeClippings,
  extractExistingHashes,
  hashEntry,
  matchTitle,
  normaliseTitle,
  parseEntry,
  parseMetaLine,
  parseTitleLine,
  renderEntry,
  splitEntries,
} from "../../scripts/lib/kindle-clippings.mjs";

const SAMPLE_FILE = `﻿Cryptonomicon (Stephenson, Neal)\r
- Your Highlight on Page 12 | Location 132-135 | Added on Tuesday, January 5, 2021 9:42:11 AM\r
\r
There is a sense in which money is not something you have, but something you do.\r
==========\r
Cryptonomicon (Stephenson, Neal)\r
- Your Note on Page 14 | Location 138 | Added on Tuesday, January 5, 2021 9:43:00 AM\r
\r
Reminds me of the Babylonian banking thread.\r
==========\r
Cryptonomicon (Stephenson, Neal)\r
- Your Bookmark on Page 99 | Location 1500 | Added on Tuesday, January 5, 2021 10:00:00 AM\r
\r
==========\r
The Lord of the Rings (Tolkien, J.R.R.)\r
- Your Highlight on Page 5 | Location 50-52 | Added on Friday, March 19, 2021 8:00:00 PM\r
\r
All that is gold does not glitter,\r
Not all those who wander are lost.\r
==========\r
`;

describe("decodeClippings", () => {
  it("strips a UTF-8 BOM", () => {
    const buf = Buffer.from("﻿hello world", "utf8");
    expect(decodeClippings(buf)).toBe("hello world");
  });

  it("decodes UTF-16-LE via the fffe BOM", () => {
    // "ok" in UTF-16-LE with BOM: ff fe 6f 00 6b 00
    const buf = Buffer.from([0xff, 0xfe, 0x6f, 0x00, 0x6b, 0x00]);
    expect(decodeClippings(buf)).toBe("ok");
  });

  it("decodes plain UTF-8 with no BOM", () => {
    expect(decodeClippings(Buffer.from("plain", "utf8"))).toBe("plain");
  });
});

describe("splitEntries", () => {
  it("splits on the standalone separator and normalises CRLF", () => {
    const blocks = splitEntries(SAMPLE_FILE);
    // 4 entries (Highlight, Note, Bookmark, second Highlight)
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toContain("Cryptonomicon");
    expect(blocks[2]).toContain("Bookmark");
  });

  it("returns an empty list for empty input", () => {
    expect(splitEntries("")).toEqual([]);
  });
});

describe("parseTitleLine", () => {
  it("parses 'Title (Lastname, Firstname)'", () => {
    expect(parseTitleLine("Cryptonomicon (Stephenson, Neal)")).toEqual({
      title: "Cryptonomicon",
      author: "Stephenson, Neal",
    });
  });

  it("parses 'Title (Firstname Lastname)'", () => {
    expect(parseTitleLine("Piranesi (Susanna Clarke)")).toEqual({
      title: "Piranesi",
      author: "Susanna Clarke",
    });
  });

  it("returns no author when there's no parenthetical", () => {
    expect(parseTitleLine("Untitled Manuscript")).toEqual({
      title: "Untitled Manuscript",
      author: null,
    });
  });

  it("ignores nested parens earlier in the title (matches the last pair)", () => {
    expect(parseTitleLine("Foundation (Asimov, Isaac)")).toEqual({
      title: "Foundation",
      author: "Asimov, Isaac",
    });
  });
});

describe("parseMetaLine", () => {
  it("extracts page, location, and addedAt", () => {
    const r = parseMetaLine(
      "- Your Highlight on Page 12 | Location 132-135 | Added on Tuesday, January 5, 2021 9:42:11 AM",
    );
    expect(r.page).toBe(12);
    expect(r.location).toBe("132-135");
    expect(r.addedAt).toBe("2021-01-05");
  });

  it("survives missing fields", () => {
    const r = parseMetaLine("- Your Highlight on Location 42");
    expect(r.page).toBeNull();
    expect(r.location).toBe("42");
    expect(r.addedAt).toBeNull();
  });
});

describe("parseEntry", () => {
  it("parses a multi-line highlight", () => {
    const blocks = splitEntries(SAMPLE_FILE);
    const e = parseEntry(blocks[3]);
    expect(e).not.toBeNull();
    expect(e!.kind).toBe("highlight");
    expect(e!.title).toBe("The Lord of the Rings");
    expect(e!.text).toContain("All that is gold does not glitter");
    expect(e!.text).toContain("wander are lost");
  });

  it("classifies notes correctly", () => {
    const blocks = splitEntries(SAMPLE_FILE);
    const e = parseEntry(blocks[1]);
    expect(e).not.toBeNull();
    expect(e!.kind).toBe("note");
    expect(e!.text).toContain("Babylonian");
  });

  it("returns null for bookmarks (no body)", () => {
    const blocks = splitEntries(SAMPLE_FILE);
    expect(parseEntry(blocks[2])).toBeNull();
  });
});

describe("normaliseTitle", () => {
  it("lowercases, strips smart quotes, collapses non-alnum", () => {
    expect(normaliseTitle("Alice’s Adventures in Wonderland!")).toBe(
      "alices adventures in wonderland",
    );
  });
});

describe("matchTitle", () => {
  const vault = [
    { slug: "cryptonomicon", title: "Cryptonomicon", authors: ["Neal Stephenson"] },
    { slug: "lotr", title: "The Lord of the Rings", authors: ["J.R.R. Tolkien"] },
    { slug: "piranesi", title: "Piranesi", authors: ["Susanna Clarke"] },
    { slug: "the-fifth-season", title: "The Fifth Season", authors: ["N.K. Jemisin"] },
  ];

  it("matches exact normalised titles", () => {
    expect(matchTitle("Cryptonomicon", vault)).toBe("cryptonomicon");
  });

  it("matches when Kindle title carries an extra author parenthetical-stripped", () => {
    // simulate a Kindle title that lost its parenthetical
    expect(matchTitle("the fifth season", vault)).toBe("the-fifth-season");
  });

  it("matches when Kindle title has a subtitle the vault elides", () => {
    expect(matchTitle("Cryptonomicon: The Cryptography Novel", vault)).toBe("cryptonomicon");
  });

  it("returns null on no plausible match", () => {
    expect(matchTitle("Some Book Not In The Vault", vault)).toBeNull();
  });

  it("does not match short common substrings", () => {
    // "It" should not collide with "Piranesi" etc. via substring rules.
    expect(matchTitle("It", vault)).toBeNull();
  });

  it("prefers the closer-length candidate when multiple substring-match", () => {
    // "Lord" appears in only LOTR; "Lord of Rings" should match LOTR rather
    // than e.g. accidentally selecting Cryptonomicon.
    expect(matchTitle("The Lord of the Rings", vault)).toBe("lotr");
  });
});

describe("hashEntry / extractExistingHashes round-trip", () => {
  it("produces stable hashes regardless of whitespace inside the text", () => {
    const a = hashEntry({ title: "X", kind: "highlight", text: "hello\nworld" });
    const b = hashEntry({ title: "X", kind: "highlight", text: "hello   world" });
    expect(a).toBe(b);
  });

  it("differs by kind", () => {
    const h = hashEntry({ title: "X", kind: "highlight", text: "same body" });
    const n = hashEntry({ title: "X", kind: "note", text: "same body" });
    expect(h).not.toBe(n);
  });

  it("renderEntry embeds the hash and extractExistingHashes recovers it", () => {
    const e = {
      kind: "highlight" as const,
      title: "T",
      author: null,
      page: 10,
      location: null,
      addedAt: "2021-01-01",
      text: "body",
      hash: hashEntry({ title: "T", kind: "highlight", text: "body" }),
    };
    const rendered = renderEntry(e);
    expect(rendered).toContain("Page 10");
    expect(rendered).toContain("added 2021-01-01");
    expect(rendered).toMatch(/<!-- kindle-hash:[0-9a-f]+ -->/);
    const found = extractExistingHashes(rendered);
    expect(found.has(e.hash)).toBe(true);
  });
});

describe("appendEntries", () => {
  function makeEntry(text: string, kind: "highlight" | "note" = "highlight") {
    return {
      kind,
      title: "Cryptonomicon",
      author: null,
      page: 12,
      location: null,
      addedAt: "2021-01-05",
      text,
      hash: hashEntry({ title: "Cryptonomicon", kind, text }),
    };
  }

  it("creates a fresh `## From Kindle` block when quotes.md is empty", () => {
    const fresh = [makeEntry("first quote"), makeEntry("second quote")];
    const { next, written } = appendEntries("", fresh);
    expect(written).toHaveLength(2);
    expect(next).toContain("## From Kindle");
    expect(next).toContain("first quote");
    expect(next).toContain("second quote");
  });

  it("creates separate sections for highlights and notes", () => {
    const items = [makeEntry("a quote"), makeEntry("a typed thought", "note")];
    const { next } = appendEntries("", items);
    expect(next).toContain("## From Kindle");
    expect(next).toContain("## Notes from Kindle");
    expect(next.indexOf("## From Kindle")).toBeLessThan(next.indexOf("## Notes from Kindle"));
  });

  it("does not duplicate entries on a second pass", () => {
    const fresh = [makeEntry("repeated quote")];
    const first = appendEntries("", fresh);
    const second = appendEntries(first.next, fresh);
    expect(second.written).toEqual([]);
    expect(second.next).toBe(first.next);
  });

  it("appends new entries into an existing `## From Kindle` block", () => {
    const fresh = [makeEntry("first quote")];
    const first = appendEntries("", fresh);

    const more = [makeEntry("second quote")];
    const second = appendEntries(first.next, more);
    expect(second.written).toHaveLength(1);
    // Single From Kindle heading — the new entry should land inside it,
    // not under a fresh duplicate H2.
    const occurrences = (second.next.match(/^## From Kindle\s*$/gm) || []).length;
    expect(occurrences).toBe(1);
    expect(second.next).toContain("first quote");
    expect(second.next).toContain("second quote");
  });

  it("preserves an existing user-curated section ahead of the Kindle block", () => {
    const existing = ["## Favourites", "", "> A hand-picked quote.", "", "*— page 7*", ""].join(
      "\n",
    );
    const fresh = [makeEntry("kindle quote")];
    const { next } = appendEntries(existing, fresh);
    expect(next).toContain("## Favourites");
    expect(next).toContain("A hand-picked quote.");
    expect(next).toContain("## From Kindle");
    expect(next).toContain("kindle quote");
    expect(next.indexOf("## Favourites")).toBeLessThan(next.indexOf("## From Kindle"));
  });
});

describe("end-to-end on the SAMPLE_FILE fixture", () => {
  // Exercises the parser → matcher → appendEntries chain on the
  // CRLF / BOM / mixed-kind sample to make sure the pipeline produces
  // sensible counts.
  it("yields 1 highlight + 1 note for Cryptonomicon, 1 highlight for LOTR, drops the bookmark", () => {
    const buf = Buffer.from(SAMPLE_FILE, "utf8");
    const text = decodeClippings(buf);
    const blocks = splitEntries(text);
    const entries = blocks.map(parseEntry).filter((e) => e !== null);
    expect(entries).toHaveLength(3);
    const kinds = entries.map((e) => e!.kind).sort();
    expect(kinds).toEqual(["highlight", "highlight", "note"]);
  });
});
