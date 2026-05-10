// Pins the pure helpers in `scripts/backfill-hardcover-reviews.mjs`.
// The script imports its dependencies at module top-level (gray-matter,
// fs); we test the exported pure helpers in isolation rather than
// running the full main() against a synthetic vault.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import { stripHtml } from "../../scripts/backfill-hardcover-reviews.mjs";

describe("stripHtml", () => {
  it("removes paragraph tags and decodes apostrophe entities", () => {
    expect(stripHtml("<p>I don&#39;t know why I waited so long.</p>")).toBe(
      "I don't know why I waited so long.",
    );
  });

  it("merges multiple paragraphs into one space-separated line", () => {
    expect(stripHtml("<p>One.</p><p>Two.</p>")).toBe("One. Two.");
  });

  it("decodes other common HTML entities", () => {
    expect(stripHtml("She said &quot;hello&quot; &amp; &lt;left&gt;.")).toBe(
      'She said "hello" & <left>.',
    );
  });

  it("strips inline italic markup but keeps the inner text", () => {
    // Inline tags are space-replaced (avoids "AnExcellent" merges from
    // `<p>An<i>excellent</i></p>`); the trailing punctuation in real
    // Hardcover bodies sits inside the wrapping <p>, so the leftover
    // space before a `.` isn't a real concern.
    expect(stripHtml("<p>An <i>excellent</i> read.</p>")).toBe("An excellent read.");
  });

  it("collapses runs of whitespace and trims", () => {
    expect(stripHtml("  <p>  hi   there  </p>  ")).toBe("hi there");
  });

  it("returns an empty string for tag-only input", () => {
    expect(stripHtml("<p></p>")).toBe("");
  });

  it("decodes numeric character references", () => {
    expect(stripHtml("<p>caf&#233;</p>")).toBe("café");
  });
});
