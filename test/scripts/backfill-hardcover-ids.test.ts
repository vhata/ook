// End-to-end coverage for `scripts/backfill-hardcover-ids.mjs`. Builds an
// ephemeral fixture vault in `os.tmpdir()` with three books — one missing
// both hardcover_slug + hardcover_id, one with the slug present but the id
// missing, one with both already set — plus a `_meta/hardcover-books.json`
// cache. Spawns the script with `--vault PATH --apply` and asserts the
// resulting frontmatter for each book.
//
// Pins:
//   - the surgical-write contract (no rewrite of unrelated frontmatter
//     lines, no quote-style change, no whitespace churn);
//   - the per-field skip logic (an already-set field is NOT overwritten,
//     even if the cache disagrees);
//   - idempotency (a second --apply run produces zero further writes);
//   - the dry-run gate (no writes without --apply).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/backfill-hardcover-ids.mjs");

let vault: string;

beforeEach(async () => {
  vault = mkdtempSync(path.join(os.tmpdir(), "ook-hci-"));
  await fs.mkdir(path.join(vault, "_meta"), { recursive: true });
  // Cache: three books, two of them populated. The third (Untouched)
  // intentionally has no cache entry, so the script should leave it alone.
  await fs.writeFile(
    path.join(vault, "_meta", "hardcover-books.json"),
    JSON.stringify({
      records: {
        BookOne: {
          goodreadsId: "111",
          hardcoverId: 4242,
          hardcoverSlug: "book-one-hc",
          rating: 4.0,
          ratings_count: 100,
          users_count: 200,
        },
        BookTwo: {
          goodreadsId: "222",
          hardcoverId: 8484,
          hardcoverSlug: "book-two-hc",
          rating: 3.5,
          ratings_count: 50,
          users_count: 80,
        },
        BookThree: {
          goodreadsId: "333",
          hardcoverId: 9999,
          hardcoverSlug: "book-three-hc",
          rating: 4.5,
          ratings_count: 10,
          users_count: 20,
        },
      },
    }),
    "utf8",
  );

  // BookOne: missing both fields. Has goodreads_id as the natural anchor.
  await fs.mkdir(path.join(vault, "BookOne"));
  await fs.writeFile(
    path.join(vault, "BookOne", "BookOne.md"),
    `---
title: Book One
authors: [First Author]
status: finished
rating: 4
goodreads_id: 111
cover: covers/book-one.svg
---

Body text.
`,
    "utf8",
  );

  // BookTwo: has hardcover_slug already (a *different* slug than the
  // cache); missing hardcover_id. The script should NOT rewrite the
  // existing slug, only add the id.
  await fs.mkdir(path.join(vault, "BookTwo"));
  await fs.writeFile(
    path.join(vault, "BookTwo", "BookTwo.md"),
    `---
title: Book Two
authors: [Second Author]
status: reading
goodreads_id: 222
hardcover_slug: book-two-manual-override
---

Body.
`,
    "utf8",
  );

  // Untouched: not in the cache. Script should leave it entirely alone.
  await fs.mkdir(path.join(vault, "Untouched"));
  await fs.writeFile(
    path.join(vault, "Untouched", "Untouched.md"),
    `---
title: Untouched
authors: [Third Author]
status: tbr
---

No goodreads.
`,
    "utf8",
  );

  // BookThree: already has both fields. Should be skipped.
  await fs.mkdir(path.join(vault, "BookThree"));
  await fs.writeFile(
    path.join(vault, "BookThree", "BookThree.md"),
    `---
title: Book Three
authors: [Fourth Author]
status: finished
goodreads_id: 333
hardcover_slug: book-three-existing
hardcover_id: 1
---

Body.
`,
    "utf8",
  );
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function runScript(args: string[]) {
  // `process.execPath` is the running node binary; safer than relying
  // on whatever `node` is on PATH inside the test runner.
  const r = spawnSync(process.execPath, [SCRIPT, "--vault", vault, ...args], {
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// Each test spawns the script in a child node process; with many vitest
// tests running in parallel under the full suite the 5s default isn't
// always enough headroom for module-resolution + script execution.
describe("backfill-hardcover-ids", { timeout: 20_000 }, () => {
  it("dry-run does not write anything", async () => {
    const before = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    const r = runScript([]);
    expect(r.status).toBe(0);
    const after = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    expect(after).toBe(before);
    // Summary line goes to stderr; per-book plan goes to stdout.
    expect(r.stdout).toContain("BookOne");
    expect(r.stdout).toContain("hardcover_slug=book-one-hc");
    expect(r.stdout).toContain("hardcover_id=4242");
  });

  it("--apply writes the missing fields and preserves existing values", async () => {
    const r = runScript(["--apply"]);
    expect(r.status).toBe(0);

    const one = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    // Fields inserted; values match the cache.
    expect(one).toMatch(/^hardcover_slug: book-one-hc$/m);
    expect(one).toMatch(/^hardcover_id: 4242$/m);
    // Slug is bare-value (no quotes); id is a bare integer.
    expect(one).not.toMatch(/^hardcover_slug: "book-one-hc"$/m);
    expect(one).not.toMatch(/^hardcover_id: "4242"$/m);
    // Inserted near the goodreads_id anchor — slug should follow
    // goodreads_id, id should follow slug.
    const idxGr = one.indexOf("goodreads_id:");
    const idxSlug = one.indexOf("hardcover_slug:");
    const idxId = one.indexOf("hardcover_id:");
    expect(idxGr).toBeGreaterThan(0);
    expect(idxSlug).toBeGreaterThan(idxGr);
    expect(idxId).toBeGreaterThan(idxSlug);
    // Closing `---` is still present and not duplicated.
    expect(one.match(/^---$/gm)?.length).toBe(2);
    // Body text untouched.
    expect(one).toContain("\n\nBody text.\n");

    const two = await fs.readFile(path.join(vault, "BookTwo", "BookTwo.md"), "utf8");
    // Existing slug preserved verbatim — the cache disagrees but we
    // never overwrite.
    expect(two).toMatch(/^hardcover_slug: book-two-manual-override$/m);
    expect(two).not.toContain("book-two-hc");
    // Id added.
    expect(two).toMatch(/^hardcover_id: 8484$/m);

    const three = await fs.readFile(path.join(vault, "BookThree", "BookThree.md"), "utf8");
    // Already-set book is byte-identical.
    expect(three).toMatch(/^hardcover_slug: book-three-existing$/m);
    expect(three).toMatch(/^hardcover_id: 1$/m);
    expect(three).not.toContain("book-three-hc");
    expect(three).not.toContain("9999");

    const untouched = await fs.readFile(path.join(vault, "Untouched", "Untouched.md"), "utf8");
    expect(untouched).not.toContain("hardcover_slug");
    expect(untouched).not.toContain("hardcover_id");
  });

  it("is idempotent on a second --apply run", async () => {
    runScript(["--apply"]);
    const after1 = await Promise.all(
      ["BookOne", "BookTwo", "BookThree", "Untouched"].map((s) =>
        fs.readFile(path.join(vault, s, `${s}.md`), "utf8"),
      ),
    );
    const r2 = runScript(["--apply"]);
    expect(r2.status).toBe(0);
    const after2 = await Promise.all(
      ["BookOne", "BookTwo", "BookThree", "Untouched"].map((s) =>
        fs.readFile(path.join(vault, s, `${s}.md`), "utf8"),
      ),
    );
    expect(after2).toEqual(after1);
    // Second-run summary should report zero writes — the helper prints
    // "(dry-run; rerun with --apply to write)" only on changeCount=0
    // dry-runs, but with --apply the doApply still fires; assert the
    // log shape via the "wrote N books" line.
    expect(r2.stderr).toContain("wrote 0 books");
  });

  it("exits non-zero when the cache file is missing", async () => {
    await fs.unlink(path.join(vault, "_meta", "hardcover-books.json"));
    const r = runScript([]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("no Hardcover cache");
  });
});
