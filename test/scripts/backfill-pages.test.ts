// End-to-end coverage for `scripts/backfill-pages.mjs`. Builds an
// ephemeral fixture vault in `os.tmpdir()` with a handful of books plus
// a `_meta/hardcover-books.json` cache that carries `pages` values,
// then spawns the script with `--vault PATH --apply` and asserts the
// resulting frontmatter.
//
// Pins:
//   - the cache → frontmatter wire (pages → pages);
//   - the per-book skip (an existing `pages:` is preserved even if
//     the cache disagrees);
//   - the missing-pages short-circuit (no write when the cache has a
//     record but no pages, or pages is 0 / null);
//   - the integer emit (`pages: <int>`);
//   - idempotency (a second --apply run produces zero further writes);
//   - the dry-run gate (no writes without --apply).

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertField } from "../../scripts/backfill-pages.mjs";

const SCRIPT = path.resolve(__dirname, "../../scripts/backfill-pages.mjs");

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
          pages: 320,
        },
        BookTwo: {
          goodreadsId: "222",
          hardcoverSlug: "book-two-hc",
          pages: 480,
        },
        BookThree: {
          goodreadsId: "333",
          hardcoverSlug: "book-three-hc",
          pages: null,
        },
        BookFour: {
          goodreadsId: "444",
          hardcoverSlug: "book-four-hc",
          pages: 0,
        },
      },
    }),
    "utf8",
  );

  // BookOne: missing pages. Has hardcover_slug as anchor.
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

  // BookTwo: pages already set. Script must leave it alone.
  await fs.mkdir(path.join(vault, "BookTwo"));
  await fs.writeFile(
    path.join(vault, "BookTwo", "BookTwo.md"),
    `---
title: Book Two
authors: [Second Author]
status: reading
goodreads_id: 222
hardcover_slug: book-two-hc
pages: 222
---

Body.
`,
    "utf8",
  );

  // BookThree: cache record has pages: null. Skip.
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

  // BookFour: cache record has pages: 0. Treated same as null.
  await fs.mkdir(path.join(vault, "BookFour"));
  await fs.writeFile(
    path.join(vault, "BookFour", "BookFour.md"),
    `---
title: Book Four
authors: [Fourth Author]
status: tbr
goodreads_id: 444
hardcover_slug: book-four-hc
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

describe("backfill-pages.mjs", () => {
  it("dry-run leaves every book untouched", async () => {
    const before = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    const res = run([]); // no --apply
    expect(res.status).toBe(0);
    const after = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    expect(after).toBe(before);
  });

  it("--apply writes `pages: <int>` after the hardcover_slug anchor", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    const written = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    expect(written).toContain("hardcover_slug: book-one-hc\npages: 320\n");
    // Original lines preserved untouched.
    expect(written).toContain("title: Book One");
    expect(written).toContain("Body text.");
  });

  it("preserves an existing pages value even when the cache disagrees", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    const written = await fs.readFile(path.join(vault, "BookTwo", "BookTwo.md"), "utf8");
    expect(written).toContain("pages: 222");
    // The cache's 480 must NOT have been written.
    expect(written).not.toContain("pages: 480");
  });

  it("skips books whose cache record has pages: null", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    const written = await fs.readFile(path.join(vault, "BookThree", "BookThree.md"), "utf8");
    expect(written).not.toContain("pages:");
  });

  it("skips books whose cache record has pages: 0", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    const written = await fs.readFile(path.join(vault, "BookFour", "BookFour.md"), "utf8");
    expect(written).not.toContain("pages:");
  });

  it("skips books without a cache entry", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    const written = await fs.readFile(path.join(vault, "Untouched", "Untouched.md"), "utf8");
    expect(written).not.toContain("pages:");
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

describe("insertField", () => {
  it("anchors after hardcover_id when present", () => {
    const raw = `---\ntitle: T\ngoodreads_id: 1\nhardcover_slug: t-hc\nhardcover_id: 4242\n---\n`;
    const out = insertField(raw, 240);
    expect(out).toContain("hardcover_id: 4242\npages: 240");
  });

  it("falls back to the closing --- when no anchors are present", () => {
    const raw = `---\ntitle: T\n---\n\nBody.\n`;
    const out = insertField(raw, 100);
    expect(out).toContain("title: T\npages: 100\n---");
  });

  it("is a no-op when pages is already present on a line", () => {
    const raw = `---\ntitle: T\npages: 999\n---\n`;
    const out = insertField(raw, 100);
    expect(out).toBe(raw);
  });
});
