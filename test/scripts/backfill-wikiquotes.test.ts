// Pins the pure helpers in `scripts/backfill-wikiquotes.mjs`. The
// network-bound fetcher isn't covered here — it's the same shape as
// the Hardcover backfills. We test the wikitext extraction (the
// fiddly bit) and the title-variant fallback ordering.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import { extractQuotes, cleanWikitext, titleVariants } from "../../scripts/backfill-wikiquotes.mjs";

describe("titleVariants", () => {
  it("starts with the bare title and adds disambiguator-suffixed forms", () => {
    const v = titleVariants("Piranesi", ["Susanna Clarke"]);
    expect(v[0]).toBe("Piranesi");
    expect(v).toContain("Piranesi (novel)");
    expect(v).toContain("Piranesi (book)");
    expect(v).toContain("Piranesi (Susanna Clarke)");
    expect(v).toContain("Piranesi (Clarke)");
  });

  it("works when the book has no authors", () => {
    const v = titleVariants("Beowulf", []);
    expect(v[0]).toBe("Beowulf");
    expect(v).toContain("Beowulf (novel)");
    // No author-suffixed variants.
    expect(v.find((x) => x.includes("("))).toMatch(/\((novel|book)\)/);
  });

  it("de-dupes variants when the surname equals the full first author name", () => {
    const v = titleVariants("Foo", ["Madonna"]);
    // The full-name and surname-only variants are the same; should
    // appear only once.
    const madonna = v.filter((x) => x === "Foo (Madonna)");
    expect(madonna).toHaveLength(1);
  });
});

describe("cleanWikitext", () => {
  it("strips {{template}} calls", () => {
    expect(cleanWikitext("Hello {{Cite book|title=Foo}} world")).toBe("Hello world");
  });

  it("strips <ref>...</ref> blocks and self-closing refs", () => {
    expect(cleanWikitext("Quote text<ref>citation</ref> here")).toBe("Quote text here");
    expect(cleanWikitext("Quote text<ref name='x' /> here")).toBe("Quote text here");
  });

  it("renders [[Target|Text]] as Text and [[Target]] as Target", () => {
    expect(cleanWikitext("See [[Piranesi (novel)|Piranesi]] for more.")).toBe(
      "See Piranesi for more.",
    );
    expect(cleanWikitext("See [[Susanna Clarke]] for more.")).toBe("See Susanna Clarke for more.");
  });

  it("flattens bold and italic markup", () => {
    expect(cleanWikitext("'''bold''' and ''italic'' words")).toBe("bold and italic words");
  });

  it("strips raw HTML tags", () => {
    expect(cleanWikitext("Quote with <small>aside</small>.")).toBe("Quote with aside.");
  });

  it("collapses whitespace runs into single spaces", () => {
    expect(cleanWikitext("  too    many   spaces  ")).toBe("too many spaces");
  });
});

describe("extractQuotes", () => {
  const SAMPLE = `'''Piranesi''' is a 2020 novel by Susanna Clarke.

== Quotes ==

* The Beauty of the House is immeasurable; its Kindness infinite.
** Opening line

* Perhaps even people you like and admire immensely can make you see the World in ways you would rather not.
** Ch. 4

* {{Cite book|title=Piranesi}} A line with a template prefix that should be stripped.

== About ==

* This section is not Quotes and should be ignored.
`;

  it("returns one entry per `*`-prefixed line under the Quotes section", () => {
    const out = extractQuotes(SAMPLE);
    expect(out.length).toBe(3);
    expect(out[0].text).toBe("The Beauty of the House is immeasurable; its Kindness infinite.");
    expect(out[1].text).toContain("Perhaps even people");
    expect(out[2].text).toBe("A line with a template prefix that should be stripped.");
  });

  it("attaches `**`-prefixed lines as the preceding quote's source", () => {
    const out = extractQuotes(SAMPLE);
    expect(out[0].source).toBe("Opening line");
    expect(out[1].source).toBe("Ch. 4");
    expect(out[2].source).toBeNull();
  });

  it("stops at the next H2 section heading", () => {
    const out = extractQuotes(SAMPLE);
    const aboutLine = out.find((q) => q.text.includes("not Quotes"));
    expect(aboutLine).toBeUndefined();
  });

  it("returns empty when no Quotes section exists", () => {
    expect(extractQuotes("== About ==\n\n* Not a quotes section.")).toEqual([]);
  });

  it("accepts `== Quotations ==` and `== Selected quotes ==` as the heading", () => {
    const body = `== Quotations ==\n\n* A single quote here.`;
    const out = extractQuotes(body);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("A single quote here.");
  });

  it("returns empty for non-string input", () => {
    expect(extractQuotes(null)).toEqual([]);
    expect(extractQuotes(undefined)).toEqual([]);
    expect(extractQuotes("")).toEqual([]);
  });

  it("merges multiple `**` attribution lines with `; ` separators", () => {
    const body = `== Quotes ==

* The quote.
** Ch. 5
** Page 142
`;
    const out = extractQuotes(body);
    expect(out[0].source).toBe("Ch. 5; Page 142");
  });
});
