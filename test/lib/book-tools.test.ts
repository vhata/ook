// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { commitPatch, getBook } from "../../src/lib/mcp/book-tools";
import { reindex } from "../../src/lib/store/index-vault";
import { MemoryStore, setStore } from "../../src/lib/store";

// commit_patch goes through the local-fs vault client (no GITHUB_BOOKS_PAT
// in the test env). We point BOOKS_DIR at a fresh tempdir cloned from
// the fixture vault so writes don't pollute the checked-in fixtures.

const FIXTURE_SRC = path.resolve(__dirname, "..", "fixtures", "vault");

let workingVault: string;

beforeEach(() => {
  workingVault = mkdtempSync(path.join(tmpdir(), "ook-book-tools-"));
  cpSync(FIXTURE_SRC, workingVault, { recursive: true });
  vi.stubEnv("BOOKS_DIR", workingVault);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setStore(null);
  rmSync(workingVault, { recursive: true, force: true });
});

describe("getBook", () => {
  it("returns frontmatter only when sections is omitted", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    const out = await getBook({ slug: "TestBook" });
    expect(out?.frontmatter.title).toBe("Test Book");
    expect(out?.sections).toEqual({});
  });

  it("returns the requested file-backed sections", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    const out = await getBook({ slug: "TestBook", sections: ["review", "quotes"] });
    expect(out?.sections.review).toContain("A short review goes here");
    expect(out?.sections.quotes).toContain("A favourite quote");
  });

  it("returns null for a slug not in the store", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    expect(await getBook({ slug: "NoSuchBook" })).toBeNull();
  });

  it("returns empty content for a missing file-backed section", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    // PrivateBook has no review.md.
    const out = await getBook({ slug: "PrivateBook", sections: ["review"] });
    expect(out?.sections.review).toBe("");
  });
});

describe("commitPatch — frontmatter changes via local-fs vault client", () => {
  it("updates a frontmatter scalar and writes the file back to disk", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    const result = await commitPatch({
      slug: "TestBook",
      frontmatter_changes: { rating: 5 },
      commit_message: "Bump rating",
    });

    expect(result.ok).toBe(true);
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].path).toBe("TestBook/TestBook.md");

    // Verify on disk.
    const onDisk = readFileSync(path.join(workingVault, "TestBook", "TestBook.md"), "utf8");
    expect(onDisk).toContain("rating: 5");

    // Verify store was optimistically updated.
    const stored = await store.get<{ rating: number | null }>("book:TestBook");
    expect(stored?.rating).toBe(5);
  });

  it("rejects a patch that wipes the title", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await expect(
      commitPatch({
        slug: "TestBook",
        frontmatter_changes: { title: null },
        commit_message: "Remove title",
      }),
    ).rejects.toThrow(/missing title/);
  });

  it("rejects an invalid status value", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await expect(
      commitPatch({
        slug: "TestBook",
        frontmatter_changes: { status: "completed" }, // not a valid BookStatus
        commit_message: "x",
      }),
    ).rejects.toThrow(/invalid status/);
  });

  it("404s when the book directory doesn't exist", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await expect(
      commitPatch({
        slug: "NoSuchBook",
        frontmatter_changes: { rating: 5 },
        commit_message: "x",
      }),
    ).rejects.toThrow(/Book not found/);
  });
});

describe("commitPatch — file-backed sections (review/quotes/summary)", () => {
  it("replaces a review.md", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    await commitPatch({
      slug: "TestBook",
      section_changes: { review: { action: "replace", content: "A new take." } },
      commit_message: "Refresh review",
    });

    const onDisk = readFileSync(path.join(workingVault, "TestBook", "review.md"), "utf8");
    expect(onDisk).toContain("A new take.");
    expect(onDisk).not.toContain("A short review goes here");
  });

  it("appends to quotes.md", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    await commitPatch({
      slug: "TestBook",
      section_changes: {
        quotes: { action: "append", content: '> "Another favourite."' },
      },
      commit_message: "More quotes",
    });

    const onDisk = readFileSync(path.join(workingVault, "TestBook", "quotes.md"), "utf8");
    expect(onDisk).toContain("A favourite quote");
    expect(onDisk).toContain("Another favourite");
  });

  it("creates a summary.md when one didn't exist before", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    await commitPatch({
      slug: "TestBook",
      section_changes: {
        summary: { action: "replace", content: "Plot summary goes here." },
      },
      commit_message: "Add summary",
    });

    const onDisk = readFileSync(path.join(workingVault, "TestBook", "summary.md"), "utf8");
    expect(onDisk).toContain("Plot summary goes here");
  });

  it("commits both reference + file-backed in one call", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    const result = await commitPatch({
      slug: "TestBook",
      frontmatter_changes: { rating: 5 },
      section_changes: { review: { action: "replace", content: "Loved it." } },
      commit_message: "Wrap up TestBook",
    });

    expect(result.commits.map((c) => c.path).sort()).toEqual([
      "TestBook/TestBook.md",
      "TestBook/review.md",
    ]);
  });
});
