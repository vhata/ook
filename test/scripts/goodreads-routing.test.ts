// Pins the shelf-aware routing in scripts/promote-goodreads.mjs.
// Imports the pure helpers via the .mjs lib so no filesystem IO is
// involved.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs lib lives outside the TS project graph
import {
  routeGoodreadsEntry,
  renderTbrBullet,
  appendTbrBullet,
} from "../../scripts/lib/goodreads-routing.mjs";

describe("routeGoodreadsEntry", () => {
  it("routes `read` to a finished vault directory", () => {
    expect(routeGoodreadsEntry("read")).toEqual({ kind: "vault-dir", status: "finished" });
  });

  it("routes `currently-reading` to a reading vault directory", () => {
    expect(routeGoodreadsEntry("currently-reading")).toEqual({
      kind: "vault-dir",
      status: "reading",
    });
  });

  it("routes `to-read` to a TBR bullet", () => {
    expect(routeGoodreadsEntry("to-read")).toEqual({ kind: "tbr-bullet" });
  });

  it("routes unknown shelves to a tbr-status vault directory (legacy fallback)", () => {
    expect(routeGoodreadsEntry("custom-shelf")).toEqual({ kind: "vault-dir", status: "tbr" });
    expect(routeGoodreadsEntry(null)).toEqual({ kind: "vault-dir", status: "tbr" });
    expect(routeGoodreadsEntry(undefined)).toEqual({ kind: "vault-dir", status: "tbr" });
  });
});

describe("renderTbrBullet", () => {
  it("renders **Title** — Author. _goodreads:<id>_ in the canonical shape", () => {
    expect(
      renderTbrBullet({
        title: "Piranesi",
        authors: ["Susanna Clarke"],
        goodreads_id: 50202953,
      }),
    ).toBe("**Piranesi** — Susanna Clarke. _goodreads:50202953_");
  });

  it("omits the why-tail when no goodreads_id is present", () => {
    expect(renderTbrBullet({ title: "Foo", authors: ["Bar"] })).toBe("**Foo** — Bar.");
  });

  it("omits the author segment when authors[] is empty", () => {
    expect(renderTbrBullet({ title: "Foo" })).toBe("**Foo**");
  });

  it("uses the first author only", () => {
    expect(renderTbrBullet({ title: "Foo", authors: ["A", "B"] })).toBe("**Foo** — A.");
  });
});

describe("appendTbrBullet", () => {
  it("appends a fresh dated From Goodreads section when no heading matches", () => {
    const before = `---
title: TBR
---

## Wanted

- **Existing** — Author.
`;
    const { content, changed } = appendTbrBullet(
      before,
      "**New** — Author. _goodreads:123_",
      "2026-05-10",
      "123",
    );
    expect(changed).toBe(true);
    expect(content).toContain("## From Goodreads (2026-05-10)");
    expect(content).toContain("- **New** — Author. _goodreads:123_");
    // Pre-existing Wanted pile preserved.
    expect(content).toContain("- **Existing** — Author.");
  });

  it("reuses an existing dated heading on the same day", () => {
    const before = `## From Goodreads (2026-05-10)

- **First** — A. _goodreads:1_
`;
    const { content } = appendTbrBullet(before, "**Second** — B. _goodreads:2_", "2026-05-10", "2");
    const headingCount = content.match(/## From Goodreads \(2026-05-10\)/g) ?? [];
    expect(headingCount).toHaveLength(1);
    expect(content).toContain("- **First**");
    expect(content).toContain("- **Second**");
  });

  it("skips the append (idempotent) when the goodreads_id already appears anywhere", () => {
    const before = `## Old Pile

- **Already** — Person. _goodreads:99_
`;
    const { content, changed } = appendTbrBullet(
      before,
      "**Dup** — Person. _goodreads:99_",
      "2026-05-10",
      "99",
    );
    expect(changed).toBe(false);
    expect(content).toBe(before);
  });

  it("handles an empty file by minting heading + bullet", () => {
    const { content, changed } = appendTbrBullet("", "**X** — Y. _goodreads:1_", "2026-05-10", "1");
    expect(changed).toBe(true);
    expect(content).toContain("## From Goodreads (2026-05-10)");
    expect(content).toContain("- **X** — Y. _goodreads:1_");
  });
});
