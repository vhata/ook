// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { commitPatchBatch } from "../../src/lib/mcp/patch-batch";
import { reindex } from "../../src/lib/store/index-vault";
import { MemoryStore, setStore } from "../../src/lib/store";

// commitPatchBatch goes through the local-fs vault client by default
// (no GITHUB_BOOKS_PAT in the test env). For the all-or-nothing tests
// we also drive a hand-rolled VaultClient that records every read /
// write so we can assert no writes happened on a rejected batch and
// that the trailer was stamped exactly once.

const FIXTURE_SRC = path.resolve(__dirname, "..", "fixtures", "vault");

let workingVault: string;

beforeEach(() => {
  workingVault = mkdtempSync(path.join(tmpdir(), "ook-patch-batch-"));
  cpSync(FIXTURE_SRC, workingVault, { recursive: true });
  vi.stubEnv("BOOKS_DIR", workingVault);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setStore(null);
  rmSync(workingVault, { recursive: true, force: true });
});

describe("commitPatchBatch — happy path via local-fs vault client", () => {
  it("lands two patches as one logical commit", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    const result = await commitPatchBatch({
      patches: [
        { slug: "TestBook", frontmatter_changes: { rating: 5 }, commit_message: "x" },
        {
          slug: "PrivateBook",
          frontmatter_changes: { status: "finished" },
          commit_message: "y",
        },
      ],
      message: "Bulk triage",
    });

    expect(result.ok).toBe(true);
    expect(result.batchSize).toBe(2);
    // One file written per patch (each ref file). Both files surface
    // in the single commits array.
    const paths = result.commits.map((c) => c.path).sort();
    expect(paths).toEqual(["PrivateBook/PrivateBook.md", "TestBook/TestBook.md"]);

    // Verify on disk.
    expect(readFileSync(path.join(workingVault, "TestBook", "TestBook.md"), "utf8")).toContain(
      "rating: 5",
    );
    expect(
      readFileSync(path.join(workingVault, "PrivateBook", "PrivateBook.md"), "utf8"),
    ).toContain("status: finished");

    // Verify both stores were optimistically updated.
    expect((await store.get<{ rating: number | null }>("book:TestBook"))?.rating).toBe(5);
    expect((await store.get<{ status: string }>("book:PrivateBook"))?.status).toBe("finished");
  });

  it("returns per-patch previews in submitted order", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    const result = await commitPatchBatch({
      patches: [
        { slug: "PrivateBook", frontmatter_changes: { rating: 3 }, commit_message: "x" },
        { slug: "TestBook", frontmatter_changes: { rating: 4 }, commit_message: "y" },
      ],
    });

    expect(result.previews.map((p) => p.slug)).toEqual(["PrivateBook", "TestBook"]);
  });
});

describe("commitPatchBatch — all-or-nothing validation", () => {
  it("rejects the whole batch when one patch wipes a title — no partial writes", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    const beforeTestBook = readFileSync(path.join(workingVault, "TestBook", "TestBook.md"), "utf8");
    const beforePrivateBook = readFileSync(
      path.join(workingVault, "PrivateBook", "PrivateBook.md"),
      "utf8",
    );

    await expect(
      commitPatchBatch({
        patches: [
          { slug: "TestBook", frontmatter_changes: { rating: 5 }, commit_message: "x" },
          {
            slug: "PrivateBook",
            frontmatter_changes: { title: null },
            commit_message: "y",
          },
        ],
      }),
    ).rejects.toThrow(/missing title/);

    // Neither file should have changed on disk.
    expect(readFileSync(path.join(workingVault, "TestBook", "TestBook.md"), "utf8")).toBe(
      beforeTestBook,
    );
    expect(readFileSync(path.join(workingVault, "PrivateBook", "PrivateBook.md"), "utf8")).toBe(
      beforePrivateBook,
    );
  });

  it("rejects when one patch carries an invalid status", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    await expect(
      commitPatchBatch({
        patches: [
          {
            slug: "TestBook",
            frontmatter_changes: { status: "completed" },
            commit_message: "x",
          },
        ],
      }),
    ).rejects.toThrow(/invalid status/);
  });

  it("404s the batch when a referenced book doesn't exist", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    await expect(
      commitPatchBatch({
        patches: [
          { slug: "TestBook", frontmatter_changes: { rating: 5 }, commit_message: "x" },
          { slug: "NoSuchBook", frontmatter_changes: { rating: 5 }, commit_message: "y" },
        ],
      }),
    ).rejects.toThrow(/Book not found/);
  });

  it("rejects an empty patches array at the helper level", async () => {
    await expect(commitPatchBatch({ patches: [] })).rejects.toThrow(/non-empty/);
  });
});

describe("commitPatchBatch — vault-client routing", () => {
  it("calls commitMultiFile (not commitFile) exactly once, with one stamped trailer", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);

    // Hand-roll a recording client. Reads delegate to the on-disk
    // fixture so applyPatch has real content to work with; writes go
    // into the recorder so we can assert there's only one of them.
    const refContent = readFileSync(path.join(workingVault, "TestBook", "TestBook.md"), "utf8");
    const refContent2 = readFileSync(
      path.join(workingVault, "PrivateBook", "PrivateBook.md"),
      "utf8",
    );

    const commitFileCalls: unknown[] = [];
    const commitMultiFileCalls: Array<{
      files: Array<{ filePath: string; content: string }>;
      message: string;
    }> = [];

    const fakeClient = {
      async getFile(p: string) {
        if (p === "TestBook/TestBook.md") return { content: refContent, sha: "test-sha" };
        if (p === "PrivateBook/PrivateBook.md") return { content: refContent2, sha: "priv-sha" };
        return null;
      },
      async commitFile(opts: unknown) {
        commitFileCalls.push(opts);
        return { sha: "x", url: null };
      },
      async commitMultiFile(opts: {
        files: Array<{ filePath: string; content: string }>;
        message: string;
      }) {
        commitMultiFileCalls.push(opts);
        return {
          sha: "batch-sha",
          url: "https://example/commit/batch-sha",
          files: opts.files.map((f) => ({ path: f.filePath, sha: `sha:${f.filePath}` })),
        };
      },
      async exists() {
        return true;
      },
      async listDirectory() {
        return [];
      },
    };

    const result = await commitPatchBatch(
      {
        patches: [
          { slug: "TestBook", frontmatter_changes: { rating: 5 }, commit_message: "x" },
          {
            slug: "PrivateBook",
            frontmatter_changes: { rating: 3 },
            commit_message: "y",
          },
        ],
        message: "Two ratings",
      },
      fakeClient,
    );

    expect(commitFileCalls).toHaveLength(0);
    expect(commitMultiFileCalls).toHaveLength(1);

    const call = commitMultiFileCalls[0];
    // Exactly one trailer on the batch message.
    const trailerMatches = call.message.match(/via ook-admin\//g) ?? [];
    expect(trailerMatches).toHaveLength(1);
    expect(call.message).toMatch(/^Two ratings\n\nvia ook-admin\/\w+$/);
    // Both files in the single tree.
    expect(call.files.map((f) => f.filePath).sort()).toEqual([
      "PrivateBook/PrivateBook.md",
      "TestBook/TestBook.md",
    ]);

    expect(result.commits.map((c) => c.url)).toEqual([
      "https://example/commit/batch-sha",
      "https://example/commit/batch-sha",
    ]);
  });

  it("synthesises a message when none is supplied", async () => {
    const refContent = readFileSync(path.join(workingVault, "TestBook", "TestBook.md"), "utf8");
    const calls: Array<{ message: string }> = [];

    const fakeClient = {
      async getFile() {
        return { content: refContent, sha: "test-sha" };
      },
      async commitFile() {
        return { sha: "x", url: null };
      },
      async commitMultiFile(opts: {
        files: Array<{ filePath: string; content: string }>;
        message: string;
      }) {
        calls.push({ message: opts.message });
        return {
          sha: "batch-sha",
          url: null,
          files: opts.files.map((f) => ({ path: f.filePath, sha: "fake" })),
        };
      },
      async exists() {
        return true;
      },
      async listDirectory() {
        return [];
      },
    };

    await commitPatchBatch(
      {
        patches: [{ slug: "TestBook", frontmatter_changes: { rating: 5 }, commit_message: "x" }],
      },
      fakeClient,
    );

    expect(calls[0].message).toMatch(/^Batch update: 1 patch\n\nvia ook-admin\/\w+$/);
  });

  it("skips the commit entirely when every patch is a no-op", async () => {
    const refContent = readFileSync(path.join(workingVault, "TestBook", "TestBook.md"), "utf8");
    const calls: unknown[] = [];

    const fakeClient = {
      async getFile() {
        return { content: refContent, sha: "test-sha" };
      },
      async commitFile() {
        return { sha: "x", url: null };
      },
      async commitMultiFile(opts: unknown) {
        calls.push(opts);
        return {
          sha: "batch-sha",
          url: null,
          files: [],
        };
      },
      async exists() {
        return true;
      },
      async listDirectory() {
        return [];
      },
    };

    // Same value as already on disk for TestBook — applyPatch
    // produces no changed frontmatter, no changed sections, so the
    // batch path skips the write.
    const result = await commitPatchBatch(
      {
        patches: [
          {
            slug: "TestBook",
            frontmatter_changes: { rating: 4.5 },
            commit_message: "no-op",
          },
        ],
      },
      fakeClient,
    );

    expect(calls).toHaveLength(0);
    expect(result.commits).toEqual([]);
    expect(result.batchSize).toBe(1);
  });
});
