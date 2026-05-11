import { describe, expect, it } from "vitest";
import { parseBookIds } from "../../src/lib/url-id-detect";

describe("parseBookIds — Goodreads", () => {
  it("parses the canonical /book/show/<id>-<slug> shape", () => {
    const r = parseBookIds("https://www.goodreads.com/book/show/12345-piranesi");
    expect(r.goodreadsId).toBe("12345");
    expect(r.titleHint).toBe("piranesi");
  });

  it("parses the older /book/show/<id>.<slug> shape", () => {
    const r = parseBookIds("https://www.goodreads.com/book/show/12345.piranesi");
    expect(r.goodreadsId).toBe("12345");
    expect(r.titleHint).toBe("piranesi");
  });

  it("works without the trailing slug", () => {
    const r = parseBookIds("https://www.goodreads.com/book/show/12345");
    expect(r.goodreadsId).toBe("12345");
    expect(r.titleHint).toBeUndefined();
  });

  it("strips query strings", () => {
    const r = parseBookIds("https://www.goodreads.com/book/show/12345-piranesi?from_search=true");
    expect(r.goodreadsId).toBe("12345");
  });

  it("accepts the bare-host form without https://", () => {
    const r = parseBookIds("goodreads.com/book/show/12345-piranesi");
    expect(r.goodreadsId).toBe("12345");
  });
});

describe("parseBookIds — Hardcover", () => {
  it("parses /books/<slug>", () => {
    const r = parseBookIds("https://hardcover.app/books/piranesi");
    expect(r.hardcoverSlug).toBe("piranesi");
    expect(r.titleHint).toBe("piranesi");
  });
});

describe("parseBookIds — Storygraph", () => {
  it("parses /books/<slug>", () => {
    const r = parseBookIds("https://app.thestorygraph.com/books/some-book-slug");
    expect(r.storygraphSlug).toBe("some-book-slug");
  });
});

describe("parseBookIds — Amazon", () => {
  it("parses /<title>/dp/<ASIN> with a title prefix", () => {
    const r = parseBookIds("https://www.amazon.com/Piranesi-Susanna-Clarke/dp/1526622432");
    expect(r.amazonAsin).toBe("1526622432");
    expect(r.titleHint).toBe("Piranesi-Susanna-Clarke");
  });

  it("parses the bare /dp/<ASIN> shape", () => {
    const r = parseBookIds("https://www.amazon.com/dp/B086DXXR9R");
    expect(r.amazonAsin).toBe("B086DXXR9R");
    expect(r.isbn10).toBeUndefined();
  });

  it("parses /gp/product/<ASIN>", () => {
    const r = parseBookIds("https://www.amazon.com/gp/product/0765326353");
    expect(r.amazonAsin).toBe("0765326353");
  });

  it("recognises a 10-digit ASIN as an ISBN-10 when the checksum holds", () => {
    // 1526622432 is the real Piranesi US paperback ISBN-10 — valid checksum.
    const r = parseBookIds("https://www.amazon.com/Piranesi/dp/1526622432");
    expect(r.amazonAsin).toBe("1526622432");
    expect(r.isbn10).toBe("1526622432");
  });

  it("does NOT mark an alphanumeric ASIN as ISBN-10", () => {
    const r = parseBookIds("https://www.amazon.com/dp/B086DXXR9R");
    expect(r.amazonAsin).toBe("B086DXXR9R");
    expect(r.isbn10).toBeUndefined();
  });

  it("works for Amazon UK / DE / other country TLDs", () => {
    const r = parseBookIds("https://www.amazon.co.uk/dp/1526622432");
    expect(r.amazonAsin).toBe("1526622432");
  });
});

describe("parseBookIds — Bookwyrm", () => {
  it("captures the full URL when an unknown host serves /book/<id>", () => {
    const r = parseBookIds("https://bookwyrm.social/book/42");
    expect(r.bookwyrmUrl).toBe("https://bookwyrm.social/book/42");
  });

  it("does NOT misfire on Goodreads", () => {
    const r = parseBookIds("https://www.goodreads.com/book/show/12345-piranesi");
    expect(r.bookwyrmUrl).toBeUndefined();
  });
});

describe("parseBookIds — non-matches", () => {
  it("returns empty for a non-book URL on a known host", () => {
    expect(parseBookIds("https://www.goodreads.com/user/show/42")).toEqual({});
  });

  it("returns empty for a totally unknown URL", () => {
    expect(parseBookIds("https://example.com/some-page")).toEqual({});
  });

  it("returns empty for whitespace input", () => {
    expect(parseBookIds("   ")).toEqual({});
  });

  it("returns empty for malformed input", () => {
    expect(parseBookIds("not a url at all")).toEqual({});
  });

  it("returns empty for the empty string", () => {
    expect(parseBookIds("")).toEqual({});
  });
});
