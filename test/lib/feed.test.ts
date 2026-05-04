import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { escapeXml, getFeedItems } from "../../src/lib/feed";

const FIXTURE_VAULT = path.resolve(__dirname, "..", "fixtures", "vault");
const SITE = "https://example.test";

beforeEach(() => {
  vi.stubEnv("BOOKS_DIR", FIXTURE_VAULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getFeedItems", () => {
  it("returns finished books with absolute URLs and a finish-derived date", async () => {
    const items = await getFeedItems(SITE);
    expect(items.map((i) => i.book.slug)).toEqual(["TestBook"]);
    expect(items[0].url).toBe(`${SITE}/books/TestBook`);
    expect(items[0].publishedAt.startsWith("2026-02-20T")).toBe(true);
    expect(items[0].title).toBe("Test Book — Author One, Author Two");
  });

  it("uses the pullquote as the summary when present", async () => {
    const items = await getFeedItems(SITE);
    expect(items[0].summary).toContain("A short, memorable line.");
    expect(items[0].summary).toContain("Ch. 5");
  });
});

describe("escapeXml", () => {
  it("escapes the five XML entities", () => {
    expect(escapeXml(`<a href="x">'b' & 'c'</a>`)).toBe(
      `&lt;a href=&quot;x&quot;&gt;&apos;b&apos; &amp; &apos;c&apos;&lt;/a&gt;`,
    );
  });
});
