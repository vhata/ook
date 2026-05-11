// Pin the LocalFsVaultClient's handling of a delete sentinel
// (MultiFileWrite with content: null) in a multi-file commit. The
// finish-flow archive flow emits one of these for `<slug>/progress.md`
// alongside the create-file for the archive path; both land in the
// same commitMultiFile call. The GitHub adapter handles the same
// shape via Git Data API tree-entry sha:null, but we don't unit-test
// that here (octokit interaction would need a wider mock).

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Re-import after each test so the LocalFsVaultClient picks up the
// per-test `BOOKS_DIR` env value via its constructor.
async function freshClient(rootDir: string) {
  process.env.BOOKS_DIR = rootDir;
  // The module reads BOOKS_DIR in the constructor; resetModules is the
  // cleanest way to force a re-import. But we go simpler: instantiate
  // the exported factory which always reads env on call.
  const mod = await import("../../src/lib/github");
  return mod.getVaultClient();
}

let root: string;
let originalBooksDir: string | undefined;
let originalPat: string | undefined;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "ook-mfd-"));
  originalBooksDir = process.env.BOOKS_DIR;
  originalPat = process.env.GITHUB_BOOKS_PAT;
  // Force the local-fs adapter path.
  delete process.env.GITHUB_BOOKS_PAT;
});

afterEach(() => {
  if (originalBooksDir !== undefined) {
    process.env.BOOKS_DIR = originalBooksDir;
  } else {
    delete process.env.BOOKS_DIR;
  }
  if (originalPat !== undefined) process.env.GITHUB_BOOKS_PAT = originalPat;
  if (root) {
    try {
      void fs.rm(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("LocalFsVaultClient.commitMultiFile — delete sentinel", () => {
  it("unlinks files whose content is null and still writes the others", async () => {
    // Seed the fixture: a source file to be removed, no archive path yet.
    await fs.mkdir(path.join(root, "TestBook"), { recursive: true });
    await fs.writeFile(path.join(root, "TestBook", "progress.md"), "running notes\n", "utf8");

    const client = await freshClient(root);
    const result = await client.commitMultiFile({
      files: [
        {
          filePath: "_meta/progress-archive/TestBook.md",
          content: "running notes\n",
        },
        {
          filePath: "TestBook/progress.md",
          content: null,
        },
      ],
      message: "archive on finish",
    });

    // Source progress.md is gone.
    await expect(fs.access(path.join(root, "TestBook", "progress.md"))).rejects.toThrow();
    // Archive landed at the new path.
    const archive = await fs.readFile(
      path.join(root, "_meta", "progress-archive", "TestBook.md"),
      "utf8",
    );
    expect(archive).toBe("running notes\n");
    // Per-file result entries are returned; deleted entry carries an empty sha.
    expect(result.files).toEqual([
      { path: "_meta/progress-archive/TestBook.md", sha: expect.any(String) },
      { path: "TestBook/progress.md", sha: "" },
    ]);
  });

  it("is forgiving when the deletion target doesn't exist (race-safe)", async () => {
    const client = await freshClient(root);
    // No file was ever created — the delete should not throw.
    const result = await client.commitMultiFile({
      files: [{ filePath: "TestBook/progress.md", content: null }],
      message: "delete a phantom",
    });
    expect(result.files).toEqual([{ path: "TestBook/progress.md", sha: "" }]);
  });
});
