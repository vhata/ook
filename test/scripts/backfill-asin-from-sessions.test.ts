// Pins the surgical-line-insert behaviour of
// `scripts/backfill-asin-from-sessions.mjs`'s `insertField` helper:
// inserts next to a priority-ordered anchor when one exists, falls back
// to the closing `---` of the frontmatter block, and refuses to
// overwrite an existing `amazon_asin:` line. The match logic is
// covered separately in `asin-match.test.ts`; the full cache → vault
// wire is exercised by a manual dry-run against the real vault.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import { insertField } from "../../scripts/backfill-asin-from-sessions.mjs";

function frontmatter(...lines: string[]) {
  return ["---", ...lines, "---", "", "Body text."].join("\n");
}

describe("insertField (amazon_asin)", () => {
  it("inserts after the highest-priority anchor that exists", () => {
    const raw = frontmatter(
      "title: Test",
      "goodreads_id: 111",
      "hardcover_slug: test-hc",
      "storygraph_slug: test-sg",
    );
    const out = insertField(raw, "B00TEST");
    expect(out).toContain("storygraph_slug: test-sg\namazon_asin: B00TEST");
    expect(out).not.toContain("\namazon_asin:.*goodreads_id");
  });

  it("falls back to a lower-priority anchor when the higher one is missing", () => {
    const raw = frontmatter("title: Test", "goodreads_id: 111");
    const out = insertField(raw, "B00TEST");
    expect(out).toContain("goodreads_id: 111\namazon_asin: B00TEST");
  });

  it("inserts before the closing --- when no anchor field exists", () => {
    const raw = frontmatter("title: Test", "status: finished");
    const out = insertField(raw, "B00TEST");
    expect(out).toContain("status: finished");
    expect(out).toMatch(/amazon_asin: B00TEST\n---/);
  });

  it("refuses to overwrite an existing amazon_asin", () => {
    const raw = frontmatter("title: Test", "amazon_asin: B00EXISTING");
    const out = insertField(raw, "B00TEST");
    expect(out).toBe(raw);
  });

  it("preserves unrelated frontmatter and body content byte-for-byte", () => {
    const raw = frontmatter(
      "title: 'It''s a Test'",
      "goodreads_id: 111",
      "tags:",
      "  - one",
      "  - two",
    );
    const out = insertField(raw, "B00TEST");
    expect(out).toContain("title: 'It''s a Test'");
    expect(out).toContain("tags:\n  - one\n  - two");
    expect(out).toContain("Body text.");
  });

  it("preserves the closing --- when an anchor is matched (no opener clobber)", () => {
    const raw = frontmatter("title: Test", "goodreads_id: 111");
    const out = insertField(raw, "B00TEST");
    // Exactly two `---` lines: opener and closer.
    const matches = out.match(/^---$/gm) ?? [];
    expect(matches).toHaveLength(2);
  });
});
