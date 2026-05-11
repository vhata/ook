// Coverage for `scripts/backfill-covers.mjs` — splits into two halves:
//
// 1. End-to-end integration on the cache-to-frontmatter path. An
//    ephemeral fixture vault in `os.tmpdir()` carries four books — one
//    missing both Hardcover entry and a populated cover, one with the
//    cache populated but a manually-set cover that must survive, one
//    with the cache populated AND an empty cover the script should
//    fill, one with no cache record at all. The script is spawned with
//    `--vault PATH --no-open-library --apply` to avoid touching the
//    network, and the resulting frontmatter is asserted file-by-file.
//
// 2. Pure-helper coverage for the Open Library fallback. The script
//    exports `coverFromOpenLibrary`, `applyCoverWrite`, and
//    `isCoverPopulated`; tests mock the global fetch to assert the
//    isbn13 → isbn → title+author waterfall and the placeholder-size
//    rejection.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import {
  applyCoverWrite,
  coverFromOpenLibrary,
  isCoverPopulated,
} from "../../scripts/backfill-covers.mjs";

const SCRIPT = path.resolve(__dirname, "../../scripts/backfill-covers.mjs");

describe("isCoverPopulated", () => {
  it("treats null, undefined, and empty/whitespace strings as empty", () => {
    expect(isCoverPopulated(null)).toBe(false);
    expect(isCoverPopulated(undefined)).toBe(false);
    expect(isCoverPopulated("")).toBe(false);
    expect(isCoverPopulated("   ")).toBe(false);
  });

  it("treats any non-empty string as populated — even a placeholder", () => {
    expect(isCoverPopulated("https://covers.openlibrary.org/b/id/1-L.jpg")).toBe(true);
    // A user-typed non-empty string the script can't interpret is still
    // protected from overwrite — deliberate write should survive.
    expect(isCoverPopulated("covers/local-svg.svg")).toBe(true);
  });
});

describe("applyCoverWrite", () => {
  const baseFrontmatter = `---
title: Sample
authors: [Anon]
cover: null
goodreads_id: 1
---

Body.
`;

  it("replaces an existing `cover: null` line in place", () => {
    const out = applyCoverWrite(baseFrontmatter, "https://example.com/x.jpg");
    expect(out).toContain("cover: https://example.com/x.jpg");
    expect(out).not.toContain("cover: null");
    // Closing `---` is not duplicated.
    expect(out.match(/^---$/gm)?.length).toBe(2);
    // Body text untouched.
    expect(out).toContain("\n\nBody.\n");
  });

  it("inserts the line before the closing `---` when no cover: line exists", () => {
    const without = `---
title: Sample
authors: [Anon]
---

Body.
`;
    const out = applyCoverWrite(without, "https://example.com/y.jpg");
    expect(out).toContain("cover: https://example.com/y.jpg");
    expect(out.match(/^---$/gm)?.length).toBe(2);
    expect(out).toContain("Body.");
    // The inserted line precedes the closing `---`, which precedes
    // the body — confirm the order rather than pinning whitespace.
    expect(out.indexOf("cover:")).toBeLessThan(out.lastIndexOf("---"));
    expect(out.lastIndexOf("---")).toBeLessThan(out.indexOf("Body."));
  });
});

describe("coverFromOpenLibrary", () => {
  function mockFetch(map: Record<string, { ok: boolean; len?: number; body?: unknown }>) {
    return async (url: string | URL, opts?: { method?: string }) => {
      const key = String(url);
      const entry = map[key];
      if (!entry) {
        return {
          ok: false,
          headers: new Map<string, string>(),
          json: async () => ({}),
        } as unknown as Response;
      }
      const headers = new Map<string, string>([["content-length", String(entry.len ?? 0)]]);
      const headersObj = {
        get(name: string) {
          return headers.get(name.toLowerCase()) ?? null;
        },
      };
      void opts;
      return {
        ok: entry.ok,
        headers: headersObj,
        json: async () => entry.body ?? {},
      } as unknown as Response;
    };
  }

  it("uses isbn13 first when both ISBNs are present", async () => {
    const probed: string[] = [];
    const fetchImpl = (async (url: string | URL, opts?: { method?: string }) => {
      probed.push(String(url));
      void opts;
      return {
        ok: true,
        headers: { get: () => "50000" },
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;
    const out = await coverFromOpenLibrary(
      { isbn13: "9780525512189", isbn: "0525512187", title: "X" },
      { fetchImpl },
    );
    expect(out).toBe("https://covers.openlibrary.org/b/isbn/9780525512189-L.jpg");
    expect(probed[0]).toContain("9780525512189");
  });

  it("falls through isbn13 → isbn when isbn13 returns a placeholder", async () => {
    const fetchImpl = mockFetch({
      "https://covers.openlibrary.org/b/isbn/9780000000000-L.jpg": { ok: true, len: 800 },
      "https://covers.openlibrary.org/b/isbn/0000000001-L.jpg": { ok: true, len: 12000 },
    }) as unknown as typeof fetch;
    const out = await coverFromOpenLibrary(
      { isbn13: "9780000000000", isbn: "0000000001", title: "X" },
      { fetchImpl },
    );
    expect(out).toBe("https://covers.openlibrary.org/b/isbn/0000000001-L.jpg");
  });

  it("falls through to search when neither ISBN probe is a real cover", async () => {
    const search = "https://openlibrary.org/search.json?title=Sample+Book&limit=5&author=Author";
    const fetchImpl = mockFetch({
      "https://covers.openlibrary.org/b/isbn/9780000000000-L.jpg": { ok: false },
      [search]: { ok: true, len: 0, body: { docs: [{ cover_i: 12345 }] } },
    }) as unknown as typeof fetch;
    const out = await coverFromOpenLibrary(
      { isbn13: "9780000000000", title: "Sample Book", authors: ["Author"] },
      { fetchImpl },
    );
    expect(out).toBe("https://covers.openlibrary.org/b/id/12345-L.jpg");
  });

  it("returns null when search has no docs with cover_i", async () => {
    const search = "https://openlibrary.org/search.json?title=No+Match&limit=5";
    const fetchImpl = mockFetch({
      [search]: { ok: true, body: { docs: [{ title: "x" }] } },
    }) as unknown as typeof fetch;
    const out = await coverFromOpenLibrary({ title: "No Match" }, { fetchImpl });
    expect(out).toBeNull();
  });

  it("returns null when frontmatter has neither ISBNs nor a title", async () => {
    const fetchImpl = (() => {
      throw new Error("should not call fetch");
    }) as unknown as typeof fetch;
    const out = await coverFromOpenLibrary({ authors: ["A"] }, { fetchImpl });
    expect(out).toBeNull();
  });
});

describe("backfill-covers integration (cache → frontmatter)", { timeout: 20_000 }, () => {
  let vault: string;

  beforeEach(async () => {
    vault = mkdtempSync(path.join(os.tmpdir(), "ook-covers-"));
    await fs.mkdir(path.join(vault, "_meta"), { recursive: true });
    // Cache: three books with image_url, one with an empty cache record,
    // one missing entirely. Plus the script will iterate the vault dirs.
    await fs.writeFile(
      path.join(vault, "_meta", "hardcover-books.json"),
      JSON.stringify({
        records: {
          BookOne: {
            goodreadsId: "111",
            hardcoverId: 1,
            hardcoverSlug: "book-one",
            image_url: "https://hc.example.com/book-one.jpg",
          },
          BookTwo: {
            goodreadsId: "222",
            hardcoverId: 2,
            hardcoverSlug: "book-two",
            image_url: "https://hc.example.com/book-two.jpg",
          },
          BookThree: {
            goodreadsId: "333",
            hardcoverId: 3,
            hardcoverSlug: "book-three",
            image_url: null,
          },
        },
      }),
      "utf8",
    );

    // BookOne — empty `cover: null`, Hardcover cache has a URL. Should
    // be written.
    await fs.mkdir(path.join(vault, "BookOne"));
    await fs.writeFile(
      path.join(vault, "BookOne", "BookOne.md"),
      `---
title: Book One
authors: [First Author]
status: finished
cover: null
goodreads_id: 111
---

Body text.
`,
      "utf8",
    );

    // BookTwo — manually-set cover, Hardcover cache disagrees. Existing
    // value must survive.
    await fs.mkdir(path.join(vault, "BookTwo"));
    await fs.writeFile(
      path.join(vault, "BookTwo", "BookTwo.md"),
      `---
title: Book Two
authors: [Second Author]
status: reading
cover: https://manual.example.com/keep-me.jpg
goodreads_id: 222
---

Body.
`,
      "utf8",
    );

    // BookThree — cover field absent entirely, cache record has
    // image_url = null. Should be left alone (no source).
    await fs.mkdir(path.join(vault, "BookThree"));
    await fs.writeFile(
      path.join(vault, "BookThree", "BookThree.md"),
      `---
title: Book Three
authors: [Third Author]
status: finished
goodreads_id: 333
---

Body.
`,
      "utf8",
    );

    // Untouched — no cache record, no cover. Without Open Library
    // fallback the script leaves it alone.
    await fs.mkdir(path.join(vault, "Untouched"));
    await fs.writeFile(
      path.join(vault, "Untouched", "Untouched.md"),
      `---
title: Untouched
authors: [Fourth Author]
status: tbr
cover: null
---

Body.
`,
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  function runScript(args: string[], envOverrides?: Record<string, string>) {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--vault", vault, "--no-open-library", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, ...(envOverrides ?? {}) },
      },
    );
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
  }

  it("dry-run does not write anything", async () => {
    const before = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    const r = runScript([]);
    expect(r.status).toBe(0);
    const after = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    expect(after).toBe(before);
    expect(r.stdout).toContain("→ BookOne");
    expect(r.stdout).toContain("+ cover: https://hc.example.com/book-one.jpg");
  });

  it("--apply writes new covers and preserves manual ones", async () => {
    const r = runScript(["--apply"]);
    expect(r.status).toBe(0);

    const one = await fs.readFile(path.join(vault, "BookOne", "BookOne.md"), "utf8");
    expect(one).toMatch(/^cover: https:\/\/hc\.example\.com\/book-one\.jpg$/m);
    expect(one).not.toContain("cover: null");
    // Closing `---` not duplicated.
    expect(one.match(/^---$/gm)?.length).toBe(2);
    // Body untouched.
    expect(one).toContain("\n\nBody text.\n");

    const two = await fs.readFile(path.join(vault, "BookTwo", "BookTwo.md"), "utf8");
    // Manual cover preserved verbatim despite cache disagreement.
    expect(two).toMatch(/^cover: https:\/\/manual\.example\.com\/keep-me\.jpg$/m);
    expect(two).not.toContain("book-two.jpg");

    const three = await fs.readFile(path.join(vault, "BookThree", "BookThree.md"), "utf8");
    // Cache record has image_url:null → no write. No cover line inserted.
    expect(three).not.toContain("cover:");

    const untouched = await fs.readFile(path.join(vault, "Untouched", "Untouched.md"), "utf8");
    // No cache hit, --no-open-library, so nothing changes.
    expect(untouched).toMatch(/^cover: null$/m);
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
    // Second run should report zero writes.
    expect(r2.stderr).toContain("wrote 0 books");
  });

  it("warns but doesn't bail when the Hardcover cache is missing", async () => {
    await fs.unlink(path.join(vault, "_meta", "hardcover-books.json"));
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("no Hardcover cache");
  });
});
