// End-to-end coverage for `scripts/build-index.mjs`. Builds a small
// ephemeral vault in `os.tmpdir()`, spawns the script with the
// build-time gate satisfied (`BOOKS_DEPLOY_KEY=test`), then asserts
// the resulting `_index.json` carries the new `trigger` frontmatter
// field on the per-book records.
//
// The index-first read path in `src/lib/books.ts` consumes whatever
// the script emits, so missing a field at build time silently strips
// it from production. This test pins the trigger projection.

import { spawnSync } from "node:child_process";
import { mkdtempSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/build-index.mjs");

let vault: string;

beforeEach(async () => {
  vault = mkdtempSync(path.join(os.tmpdir(), "ook-build-index-"));

  // Book with a populated trigger.
  await fs.mkdir(path.join(vault, "Triggered"));
  await fs.writeFile(
    path.join(vault, "Triggered", "Triggered.md"),
    `---
title: Triggered
authors: [Someone]
status: reading
trigger: Saw it on a friend's shelf.
---

Body.
`,
    "utf8",
  );

  // Book with no trigger frontmatter at all.
  await fs.mkdir(path.join(vault, "Bare"));
  await fs.writeFile(
    path.join(vault, "Bare", "Bare.md"),
    `---
title: Bare
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

function run() {
  return spawnSync("node", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, BOOKS_DIR: vault, BOOKS_DEPLOY_KEY: "test" },
  });
}

describe("build-index.mjs — trigger field", () => {
  it("writes `trigger` on books that have it in frontmatter", async () => {
    const res = run();
    expect(res.status).toBe(0);
    const raw = await fs.readFile(path.join(vault, "_index.json"), "utf8");
    const parsed = JSON.parse(raw) as { books: Array<Record<string, unknown>> };
    const triggered = parsed.books.find((b) => b.slug === "Triggered");
    expect(triggered?.trigger).toBe("Saw it on a friend's shelf.");
  });

  it("emits `trigger: null` on books without the field", async () => {
    const res = run();
    expect(res.status).toBe(0);
    const raw = await fs.readFile(path.join(vault, "_index.json"), "utf8");
    const parsed = JSON.parse(raw) as { books: Array<Record<string, unknown>> };
    const bare = parsed.books.find((b) => b.slug === "Bare");
    expect(bare?.trigger).toBeNull();
  });
});
