// Pins the surgical insertField behaviour of
// `scripts/backfill-started-from-sessions.mjs`: insert next to the
// `progress:` anchor (priority 1), fall back through `status:` / `tags:` /
// `bingo_squares:` / finally the closing `---`. Never overwrites an
// existing real `started:` date, but DOES replace placeholder
// `started: null` / `""` / `''` in place. Plus the small `hasRealStarted`
// gate that decides whether the script-level skip fires. The
// cache-read + diff / prompt-to-apply flow is covered by a manual
// dry-run; the line-level branching is what the tests pin.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import { hasRealStarted, insertField } from "../../scripts/backfill-started-from-sessions.mjs";

function frontmatter(...lines: string[]) {
  return ["---", ...lines, "---", "", "Body text."].join("\n");
}

describe("insertField (started)", () => {
  it("inserts after `progress:` when present (highest-priority anchor)", () => {
    const raw = frontmatter(
      "title: Test",
      "status: finished",
      'progress: ""',
      "finished: 2024-06-15",
    );
    const out = insertField(raw, "2024-06-01");
    expect(out).toContain('progress: ""\nstarted: 2024-06-01');
    expect(out).toContain("started: 2024-06-01\nfinished: 2024-06-15");
  });

  it("falls back to `status:` when `progress:` is absent", () => {
    const raw = frontmatter("title: Test", "status: finished", "finished: 2024-06-15");
    const out = insertField(raw, "2024-06-01");
    expect(out).toContain("status: finished\nstarted: 2024-06-01");
  });

  it("falls back to the closing --- when none of the anchors match", () => {
    const raw = frontmatter("title: Test", "amazon_asin: B00X");
    const out = insertField(raw, "2024-06-01");
    expect(out).toMatch(/started: 2024-06-01\n---/);
  });

  it("refuses to overwrite an existing real `started:` date", () => {
    const raw = frontmatter("title: Test", "status: finished", "started: 2020-01-01");
    const out = insertField(raw, "2024-06-01");
    expect(out).toBe(raw);
  });

  it("replaces a placeholder `started: null` in place rather than inserting elsewhere", () => {
    const raw = frontmatter(
      "title: Test",
      "status: finished",
      'progress: ""',
      "started: null",
      "finished: 2024-06-15",
    );
    const out = insertField(raw, "2024-06-01");
    expect(out).toContain("started: 2024-06-01\nfinished: 2024-06-15");
    expect(out).not.toContain("started: null");
    const matches = out.match(/^started:/gm) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('replaces a placeholder `started: ""` in place', () => {
    const raw = frontmatter("title: Test", "status: finished", 'started: ""');
    const out = insertField(raw, "2024-06-01");
    expect(out).toContain("started: 2024-06-01");
    expect(out).not.toContain('started: ""');
  });

  it("preserves unrelated frontmatter and body verbatim", () => {
    const raw = frontmatter(
      "title: 'It''s a Test'",
      "status: finished",
      "tags:",
      "  - one",
      "  - two",
    );
    const out = insertField(raw, "2024-06-01");
    expect(out).toContain("title: 'It''s a Test'");
    expect(out).toContain("tags:\n  - one\n  - two");
    expect(out).toContain("Body text.");
  });

  it("preserves the closing --- when an anchor is matched (no opener clobber)", () => {
    const raw = frontmatter("title: Test", "status: finished");
    const out = insertField(raw, "2024-06-01");
    const matches = out.match(/^---$/gm) ?? [];
    expect(matches).toHaveLength(2);
  });
});

describe("hasRealStarted", () => {
  it("treats a YYYY-MM-DD string as a real value", () => {
    expect(hasRealStarted("2024-06-01")).toBe(true);
  });

  it("treats null / undefined / empty string as no value", () => {
    expect(hasRealStarted(null)).toBe(false);
    expect(hasRealStarted(undefined)).toBe(false);
    expect(hasRealStarted("")).toBe(false);
  });

  it("treats a valid Date as a real value (gray-matter parses bare YAML dates)", () => {
    expect(hasRealStarted(new Date("2024-06-01"))).toBe(true);
  });

  it("treats an invalid Date as no value", () => {
    expect(hasRealStarted(new Date("not-a-date"))).toBe(false);
  });
});
