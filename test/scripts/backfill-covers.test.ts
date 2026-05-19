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
  buildGoogleBooksQueries,
  coverFromGoogleBooks,
  coverFromOpenLibrary,
  findOpenLibraryCandidate,
  isCoverPopulated,
  parseGoogleBooksThumbnail,
  pickPreferredCoverId,
  readCoverPreferences,
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

// Shared fetch mock factory used by the new fallback / preference suites.
function makeMockFetch(
  map: Record<string, { ok: boolean; len?: number; body?: unknown }>,
): typeof fetch {
  return (async (url: string | URL, opts?: { method?: string }) => {
    const key = String(url);
    const entry = map[key];
    void opts;
    if (!entry) {
      return {
        ok: false,
        headers: { get: () => null },
        json: async () => ({}),
      } as unknown as Response;
    }
    return {
      ok: entry.ok,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-length" ? String(entry.len ?? 0) : null,
      },
      json: async () => entry.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("findOpenLibraryCandidate — ISBN13 marginal fallback", () => {
  it("returns the marginal ISBN13 URL when both ISBN probes are thin AND title+author returns nothing", async () => {
    // ISBN13 → placeholder-sized response (marginal); ISBN10 also thin;
    // title+author search returns no docs. Behaviour change: instead of
    // null, the function reports the ISBN13 URL marked marginal so the
    // caller can keep it as a last resort.
    const isbn13Url = "https://covers.openlibrary.org/b/isbn/9780000000000-L.jpg";
    const isbn10Url = "https://covers.openlibrary.org/b/isbn/0000000001-L.jpg";
    const search = "https://openlibrary.org/search.json?title=Quiet+Book&limit=5&author=Anon";
    const fetchImpl = makeMockFetch({
      [isbn13Url]: { ok: true, len: 800 },
      [isbn10Url]: { ok: true, len: 700 },
      [search]: { ok: true, body: { docs: [] } },
    });
    const found = await findOpenLibraryCandidate(
      {
        isbn13: "9780000000000",
        isbn: "0000000001",
        title: "Quiet Book",
        authors: ["Anon"],
      },
      { fetchImpl },
    );
    expect(found).toEqual({ url: isbn13Url, marginal: true });
  });

  it("returns null when the ISBN13 probe missed entirely (no placeholder) and title+author also failed", async () => {
    // A hard 404 from the covers API is "miss" — not marginal — and
    // doesn't seed the floor. We only fall back to ISBN13 when there
    // was at least a placeholder hit anchoring a real edition.
    const isbn13Url = "https://covers.openlibrary.org/b/isbn/9780000000001-L.jpg";
    const search = "https://openlibrary.org/search.json?title=Gone&limit=5";
    const fetchImpl = makeMockFetch({
      [isbn13Url]: { ok: false },
      [search]: { ok: true, body: { docs: [] } },
    });
    const found = await findOpenLibraryCandidate(
      { isbn13: "9780000000001", title: "Gone" },
      { fetchImpl },
    );
    expect(found).toBeNull();
  });

  it("prefers a real title+author match over a marginal ISBN13 candidate", async () => {
    // Even though ISBN13 returned a marginal candidate, a real cover_i
    // from the search is the better answer — marginal is a last resort,
    // not a tie-breaker.
    const isbn13Url = "https://covers.openlibrary.org/b/isbn/9780000000002-L.jpg";
    const search = "https://openlibrary.org/search.json?title=Found+Book&limit=5";
    const fetchImpl = makeMockFetch({
      [isbn13Url]: { ok: true, len: 600 },
      [search]: { ok: true, body: { docs: [{ cover_i: 42 }] } },
    });
    const found = await findOpenLibraryCandidate(
      { isbn13: "9780000000002", title: "Found Book" },
      { fetchImpl },
    );
    expect(found).toEqual({
      url: "https://covers.openlibrary.org/b/id/42-L.jpg",
      marginal: false,
    });
  });
});

describe("buildGoogleBooksQueries", () => {
  it("starts with the ISBN13 query when present", () => {
    const qs = buildGoogleBooksQueries({
      isbn13: "9780525512189",
      isbn: "0525512187",
      title: "Piranesi",
      authors: ["Susanna Clarke"],
    });
    expect(qs[0]).toBe("isbn:9780525512189");
  });

  it("adds an ISBN10 query when it differs from the ISBN13", () => {
    const qs = buildGoogleBooksQueries({
      isbn13: "9780525512189",
      isbn: "0525512187",
      title: "Piranesi",
    });
    expect(qs).toContain("isbn:9780525512189");
    expect(qs).toContain("isbn:0525512187");
  });

  it("falls through to an intitle+inauthor query when ISBNs are missing", () => {
    const qs = buildGoogleBooksQueries({ title: "Piranesi", authors: ["Susanna Clarke"] });
    expect(qs).toEqual(["intitle:Piranesi inauthor:Susanna Clarke"]);
  });

  it("returns an empty list when neither ISBNs nor a title are available", () => {
    expect(buildGoogleBooksQueries({ authors: ["A"] })).toEqual([]);
    expect(buildGoogleBooksQueries({})).toEqual([]);
  });
});

describe("parseGoogleBooksThumbnail", () => {
  it("returns the first non-empty thumbnail across items[]", () => {
    const json = {
      items: [
        { volumeInfo: { imageLinks: {} } },
        {
          volumeInfo: {
            imageLinks: {
              thumbnail: "http://books.google.com/books/content?id=abc&zoom=1",
            },
          },
        },
      ],
    };
    expect(parseGoogleBooksThumbnail(json)).toBe(
      "http://books.google.com/books/content?id=abc&zoom=1",
    );
  });

  it("prefers thumbnail over smallThumbnail when both are present", () => {
    const json = {
      items: [
        {
          volumeInfo: {
            imageLinks: {
              smallThumbnail: "http://small.example/x.jpg",
              thumbnail: "http://thumb.example/x.jpg",
            },
          },
        },
      ],
    };
    expect(parseGoogleBooksThumbnail(json)).toBe("http://thumb.example/x.jpg");
  });

  it("falls back to smallThumbnail when only that key is present", () => {
    const json = {
      items: [
        {
          volumeInfo: {
            imageLinks: { smallThumbnail: "http://small.example/x.jpg" },
          },
        },
      ],
    };
    expect(parseGoogleBooksThumbnail(json)).toBe("http://small.example/x.jpg");
  });

  it("returns null when items is empty or undefined", () => {
    expect(parseGoogleBooksThumbnail({})).toBeNull();
    expect(parseGoogleBooksThumbnail({ items: [] })).toBeNull();
    expect(parseGoogleBooksThumbnail({ items: [{ volumeInfo: {} }] })).toBeNull();
  });
});

describe("coverFromGoogleBooks", () => {
  it("queries by ISBN13 first, parses the thumbnail, then HEAD-probes for size", async () => {
    const search =
      "https://www.googleapis.com/books/v1/volumes?q=isbn%3A9780525512189&maxResults=5";
    const thumb = "http://books.google.com/books/content?id=abc&zoom=1";
    const fetchImpl = makeMockFetch({
      [search]: {
        ok: true,
        body: { items: [{ volumeInfo: { imageLinks: { thumbnail: thumb } } }] },
      },
      [thumb]: { ok: true, len: 30000 },
    });
    const out = await coverFromGoogleBooks({ isbn13: "9780525512189", title: "X" }, { fetchImpl });
    expect(out).toBe(thumb);
  });

  it("returns null when the thumbnail HEAD-probe says placeholder", async () => {
    const search =
      "https://www.googleapis.com/books/v1/volumes?q=isbn%3A9780000000005&maxResults=5";
    const thumb = "http://books.google.com/books/content?id=tiny";
    const fetchImpl = makeMockFetch({
      [search]: {
        ok: true,
        body: { items: [{ volumeInfo: { imageLinks: { thumbnail: thumb } } }] },
      },
      [thumb]: { ok: true, len: 500 },
    });
    const out = await coverFromGoogleBooks({ isbn13: "9780000000005" }, { fetchImpl });
    expect(out).toBeNull();
  });

  it("falls through ISBN → intitle+inauthor when ISBN returns no items", async () => {
    const isbnSearch =
      "https://www.googleapis.com/books/v1/volumes?q=isbn%3A9780000000006&maxResults=5";
    const titleSearch =
      "https://www.googleapis.com/books/v1/volumes?q=intitle%3ASample%20inauthor%3AAuthor&maxResults=5";
    const thumb = "http://books.google.com/books/content?id=ok&zoom=1";
    const fetchImpl = makeMockFetch({
      [isbnSearch]: { ok: true, body: { items: [] } },
      [titleSearch]: {
        ok: true,
        body: { items: [{ volumeInfo: { imageLinks: { thumbnail: thumb } } }] },
      },
      [thumb]: { ok: true, len: 30000 },
    });
    const out = await coverFromGoogleBooks(
      { isbn13: "9780000000006", title: "Sample", authors: ["Author"] },
      { fetchImpl },
    );
    expect(out).toBe(thumb);
  });
});

describe("pickPreferredCoverId — language preference", () => {
  it("picks the English-language doc when no frontmatter language is set", () => {
    const docs = [
      { cover_i: 11, language: ["fre"] },
      { cover_i: 22, language: ["eng"] },
      { cover_i: 33, language: ["ger"] },
    ];
    expect(pickPreferredCoverId(docs, {})).toBe(22);
  });

  it("honours an explicit language preference (de)", () => {
    const docs = [
      { cover_i: 11, language: ["fre"] },
      { cover_i: 22, language: ["eng"] },
      { cover_i: 33, language: ["ger"] },
    ];
    expect(pickPreferredCoverId(docs, { language: "de" })).toBe(33);
  });

  it("falls back to the first candidate when no language matches", () => {
    const docs = [
      { cover_i: 11, language: ["fre"] },
      { cover_i: 22, language: ["spa"] },
    ];
    // Default language is English; neither doc matches, so the natural
    // result is the first candidate — deterministic, not random.
    expect(pickPreferredCoverId(docs, {})).toBe(11);
  });

  it("ignores docs that lack a cover_i", () => {
    const docs = [{ language: ["eng"] }, { cover_i: 99, language: ["fre"] }];
    expect(pickPreferredCoverId(docs, {})).toBe(99);
  });
});

describe("pickPreferredCoverId — region preference", () => {
  it("biases toward the UK candidate when region=uk", () => {
    const docs = [
      { cover_i: 1, language: ["eng"], publish_place: ["New York"] },
      { cover_i: 2, language: ["eng"], publish_place: ["London"] },
      { cover_i: 3, language: ["eng"], publish_place: ["Boston"] },
    ];
    expect(pickPreferredCoverId(docs, { region: "uk" })).toBe(2);
  });

  it("biases toward the US candidate when region=us", () => {
    const docs = [
      {
        cover_i: 1,
        language: ["eng"],
        publisher: ["Bloomsbury Publishing"],
        publish_place: ["London"],
      },
      { cover_i: 2, language: ["eng"], publisher: ["Scholastic"], publish_place: ["New York"] },
    ];
    expect(pickPreferredCoverId(docs, { region: "us" })).toBe(2);
  });

  it("falls back to language-only ranking when no region tokens match", () => {
    const docs = [
      { cover_i: 1, language: ["eng"], publish_place: ["Tokyo"] },
      { cover_i: 2, language: ["fre"], publish_place: ["Paris"] },
    ];
    // region=uk doesn't match either doc; language=en still picks doc 1.
    expect(pickPreferredCoverId(docs, { region: "uk" })).toBe(1);
  });
});

describe("readCoverPreferences", () => {
  it("returns null language and region when no frontmatter fields are set", () => {
    const out = readCoverPreferences({});
    expect(out.language).toBeNull();
    expect(out.region).toBeNull();
  });

  it("reads `language:` and `region:` straight from frontmatter when present", () => {
    const out = readCoverPreferences({ language: "de", region: "UK" });
    expect(out.language).toBe("de");
    expect(out.region).toBe("UK");
  });

  it("infers region from an `edition:` field naming a market", () => {
    expect(readCoverPreferences({ edition: "UK paperback" }).region).toBe("uk");
    expect(readCoverPreferences({ edition: "US Hardcover" }).region).toBe("us");
  });

  it("prefers an explicit `region:` over the `edition:` inference", () => {
    const out = readCoverPreferences({ region: "AU", edition: "UK paperback" });
    expect(out.region).toBe("AU");
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
      // Disable both external fallbacks so the integration suite stays
      // network-free regardless of which sources the script supports.
      [SCRIPT, "--vault", vault, "--no-open-library", "--no-google-books", ...args],
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
