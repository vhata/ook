import { describe, expect, it } from "vitest";
import { enrichWithUrlIds } from "../../src/lib/admin/agent";

// URL-paste enrichment runs before the user's free-text input hits
// the Claude API. The LLM sees the message with a parenthetical
// annotation of any IDs we parsed out of a pasted URL — so the
// "one paste, one confirm" capture flow doesn't need a dedicated
// agent tool call.

describe("enrichWithUrlIds", () => {
  it("appends a parenthetical with goodreads_id when a Goodreads URL is pasted", () => {
    const out = enrichWithUrlIds(
      "started Piranesi today https://www.goodreads.com/book/show/50202953-piranesi",
    );
    expect(out).toContain("started Piranesi today");
    expect(out).toContain("(Parsed from https://www.goodreads.com/book/show/50202953-piranesi:");
    expect(out).toContain("goodreadsId: 50202953");
    expect(out).toContain("titleHint: piranesi");
  });

  it("returns the input unchanged when no URLs are present", () => {
    const out = enrichWithUrlIds("just a regular reading update");
    expect(out).toBe("just a regular reading update");
  });

  it("returns the input unchanged when the only URL is one we don't recognise", () => {
    const out = enrichWithUrlIds("see https://example.com/some-page");
    expect(out).toBe("see https://example.com/some-page");
  });

  it("strips trailing punctuation from the matched URL", () => {
    const out = enrichWithUrlIds(
      "look at https://www.goodreads.com/book/show/50202953-piranesi, it's great.",
    );
    expect(out).toContain("(Parsed from https://www.goodreads.com/book/show/50202953-piranesi:");
    // The note's URL must not include the trailing comma.
    expect(out).not.toContain("piranesi,:");
  });

  it("emits one note per URL when several are pasted", () => {
    const out = enrichWithUrlIds(
      "https://www.goodreads.com/book/show/50202953-piranesi vs https://hardcover.app/books/piranesi",
    );
    expect(out).toContain("goodreadsId: 50202953");
    expect(out).toContain("hardcoverSlug: piranesi");
    expect(out.match(/\(Parsed from/g)?.length).toBe(2);
  });

  it("includes ASIN and ISBN-10 hints in the parenthetical for Amazon URLs", () => {
    const out = enrichWithUrlIds(
      "got this one on amazon https://www.amazon.com/Piranesi/dp/1526622432",
    );
    expect(out).toContain("amazonAsin: 1526622432");
    expect(out).toContain("isbn10: 1526622432");
  });
});
