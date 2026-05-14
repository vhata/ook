// Pins the surgical line edit behind `scripts/pause-stale-reading.mjs`:
// `pausesReadingStatus(raw)` replaces a `status: reading` line with
// `status: paused`, leaves everything else intact, and refuses to act
// when no matching line exists. The cache-walk + diff / prompt-to-apply
// flow is covered by manual dry-run against the real vault; the
// branchy logic lives here.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import { pausesReadingStatus } from "../../scripts/pause-stale-reading.mjs";

function frontmatter(...lines: string[]) {
  return ["---", ...lines, "---", "", "Body text."].join("\n");
}

describe("pausesReadingStatus", () => {
  it("replaces `status: reading` with `status: paused`", () => {
    const raw = frontmatter("title: Test", "status: reading", "started: 2017-01-01");
    const out = pausesReadingStatus(raw);
    expect(out).toContain("status: paused");
    expect(out).not.toContain("status: reading");
  });

  it("does not touch a book whose status is not reading", () => {
    const raw = frontmatter("title: Test", "status: finished", "finished: 2024-01-01");
    expect(pausesReadingStatus(raw)).toBe(raw);
  });

  it("does not touch a book that is already paused", () => {
    const raw = frontmatter("title: Test", "status: paused");
    expect(pausesReadingStatus(raw)).toBe(raw);
  });

  it("preserves unrelated frontmatter and body verbatim", () => {
    const raw = frontmatter(
      "title: 'It''s a Test'",
      "status: reading",
      "tags:",
      "  - one",
      "  - two",
    );
    const out = pausesReadingStatus(raw);
    expect(out).toContain("title: 'It''s a Test'");
    expect(out).toContain("tags:\n  - one\n  - two");
    expect(out).toContain("Body text.");
  });

  it("only flips the first matching status line and leaves quoted occurrences alone", () => {
    // A `status: reading` mention in the body markdown shouldn't be
    // touched — the regex anchors to start-of-line and requires no
    // leading whitespace.
    const raw =
      frontmatter("title: Test", "status: reading") +
      '\n\nNote: I said "status: reading" in the body.\n';
    const out = pausesReadingStatus(raw);
    const frontmatterStatus = out.match(/^status:.*$/m)?.[0];
    expect(frontmatterStatus).toBe("status: paused");
    expect(out).toContain('"status: reading"');
  });
});
