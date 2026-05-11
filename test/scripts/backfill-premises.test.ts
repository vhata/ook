// End-to-end coverage for `scripts/backfill-premises.mjs`. Builds an
// ephemeral fixture vault in `os.tmpdir()` with a handful of books plus
// a `_meta/hardcover-books.json` cache that carries some `description`
// values, then spawns the script with `--vault PATH --apply` and asserts
// the resulting frontmatter.
//
// Pins:
//   - the cache → frontmatter wire (description → premise);
//   - the per-book skip (an existing `premise:` is preserved even if
//     the cache disagrees);
//   - the missing-description short-circuit (no write when the cache
//     has a record but no description);
//   - the folded-block-scalar emit (`premise: >-` + indented wrap);
//   - idempotency (a second --apply run produces zero further writes);
//   - the dry-run gate (no writes without --apply).

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPremiseBlock, insertBlock } from "../../scripts/backfill-premises.mjs";

const SCRIPT = path.resolve(__dirname, "../../scripts/backfill-premises.mjs");

let vault: string;

beforeEach(async () => {
  vault = mkdtempSync(path.join(os.tmpdir(), "ook-bp-"));
  await fs.mkdir(path.join(vault, "_meta"), { recursive: true });
  await fs.writeFile(
    path.join(vault, "_meta", "hardcover-books.json"),
    JSON.stringify({
      records: {
        BookOne: {
          goodreadsId: "111",
          hardcoverSlug: "book-one-hc",
          description: "A retired engineer wakes up on a strange island and has to figure out why.",
        },
        BookTwo: {
          goodreadsId: "222",
          hardcoverSlug: "book-two-hc",
          description:
            "A long, drawn-out family saga that spans three generations and two continents, told from the perspective of the youngest daughter.",
        },
        BookThree: {
          goodreadsId: "333",
          hardcoverSlug: "book-three-hc",
          description: null,
        },
      },
    }),
    "utf8",
  );

  // BookOne: missing premise. Has goodreads_id and hardcover_slug as anchors.
  await fs.mkdir(path.join(vault, "BookOne"));
  await fs.writeFile(
    path.join(vault, "BookOne", "BookOne.md"),
    `---
title: Book One
authors: [First Author]
status: finished
goodreads_id: 111
hardcover_slug: book-one-hc
---

Body text.
`,
    "utf8",
  );

  // BookTwo: premise already set. Script must leave it alone.
  await fs.mkdir(path.join(vault, "BookTwo"));
  await fs.writeFile(
    path.join(vault, "BookTwo", "BookTwo.md"),
    `---
title: Book Two
authors: [Second Author]
status: reading
goodreads_id: 222
hardcover_slug: book-two-hc
premise: A hand-typed blurb the user wrote themselves.
---

Body.
`,
    "utf8",
  );

  // BookThree: cache record has description: null. Skip.
  await fs.mkdir(path.join(vault, "BookThree"));
  await fs.writeFile(
    path.join(vault, "BookThree", "BookThree.md"),
    `---
title: Book Three
authors: [Third Author]
status: tbr
goodreads_id: 333
hardcover_slug: book-three-hc
---

Body.
`,
    "utf8",
  );

  // Untouched: no cache entry at all. Skip.
  await fs.mkdir(path.join(vault, "Untouched"));
  await fs.writeFile(
    path.join(vault, "Untouched", "Untouched.md"),
    `---
title: Untouched
authors: [Mystery]
status: tbr
---

Body.
`,
    "utf8",
  );
});

afterEach(() => {
  if (vault) {
    // Best-effort cleanup; the OS will sweep tmpdir eventually if this fails.
    try {
      void fs.rm(vault, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function run(args: string[] = []) {
  return spawnSync("node", [SCRIPT, "--vault", vault, ...args], { encoding: "utf8" });
}

describe("backfill-premises.mjs", () => {
  it("dry-run leaves every book untouched", async () => {
    const before = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    const res = run([]); // no --apply
    expect(res.status).toBe(0);
    const after = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    expect(after).toBe(before);
  });

  it("--apply writes the premise as a folded block scalar after the hardcover_slug anchor", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    const written = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    expect(written).toContain("hardcover_slug: book-one-hc\npremise: >-\n");
    expect(written).toContain(
      "  A retired engineer wakes up on a strange island and has to figure",
    );
    // Original lines preserved untouched.
    expect(written).toContain("title: Book One");
    expect(written).toContain("authors: [First Author]");
    expect(written).toContain("status: finished");
    expect(written).toContain("Body text.");
  });

  it("preserves an existing premise even when the cache disagrees", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    const written = await fs.readFile(path.join(vault, "BookTwo", "BookTwo.md"), "utf8");
    expect(written).toContain("premise: A hand-typed blurb the user wrote themselves.");
    // The cache's description for BookTwo must NOT have been written.
    expect(written).not.toContain("A long, drawn-out family saga");
  });

  it("skips books whose cache record has no description", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    const written = await fs.readFile(path.join(vault, "BookThree", "BookThree.md"), "utf8");
    expect(written).not.toContain("premise:");
  });

  it("skips books without a cache entry", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    const written = await fs.readFile(path.join(vault, "Untouched", "Untouched.md"), "utf8");
    expect(written).not.toContain("premise:");
  });

  it("is idempotent — a second --apply produces no further changes", async () => {
    const first = run(["--apply"]);
    expect(first.status).toBe(0);
    const afterFirst = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    const second = run(["--apply"]);
    expect(second.status).toBe(0);
    const afterSecond = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    expect(afterSecond).toBe(afterFirst);
  });

  it("exits 2 when the Hardcover cache file is missing", async () => {
    await fs.rm(path.join(vault, "_meta", "hardcover-books.json"));
    const res = run([]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("no Hardcover cache");
  });
});

describe("formatPremiseBlock", () => {
  it("emits a folded block scalar with `premise: >-` followed by indented wrapped lines", () => {
    const block = formatPremiseBlock("A short premise.");
    expect(block.split("\n")[0]).toBe("premise: >-");
    expect(block.split("\n")[1]).toBe("  A short premise.");
  });

  it("collapses multiple whitespace runs (including newlines) into single spaces", () => {
    const block = formatPremiseBlock("Word one.\n\n  Word two.\tWord three.");
    expect(block).toBe("premise: >-\n  Word one. Word two. Word three.");
  });

  it("word-wraps long input at the 70-char target", () => {
    const longText = "x ".repeat(60).trim(); // ~119 chars of tokens
    const block = formatPremiseBlock(longText);
    const wrapped = block
      .split("\n")
      .slice(1)
      .map((l) => l.trimStart());
    // Each wrapped line should be ≤ 70 chars before indentation; assert
    // the first wrap line is non-trivial and total reflects the input.
    expect(wrapped.length).toBeGreaterThan(1);
    for (const l of wrapped) expect(l.length).toBeLessThanOrEqual(70);
  });
});

describe("insertBlock", () => {
  it("anchors after hardcover_slug when present", () => {
    const raw = `---\ntitle: T\ngoodreads_id: 1\nhardcover_slug: t-hc\n---\n`;
    const block = "premise: >-\n  Body.";
    const out = insertBlock(raw, block);
    expect(out).toContain("hardcover_slug: t-hc\npremise: >-\n  Body.");
  });

  it("falls back to the closing --- when no anchors are present", () => {
    const raw = `---\ntitle: T\n---\n\nBody.\n`;
    const block = "premise: >-\n  Body.";
    const out = insertBlock(raw, block);
    expect(out).toContain("title: T\npremise: >-\n  Body.\n---");
  });

  it("is a no-op when premise is already present on a line", () => {
    const raw = `---\ntitle: T\npremise: existing\n---\n`;
    const block = "premise: >-\n  New.";
    const out = insertBlock(raw, block);
    expect(out).toBe(raw);
  });
});
