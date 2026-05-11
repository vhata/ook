// End-to-end coverage for `scripts/rename-summary-to-progress.mjs`.
// Builds a small fixture vault with three books (one with summary.md
// only, one with both summary.md AND progress.md, one with neither),
// spawns the script with `--vault PATH --apply`, and asserts that:
//   - the bare summary.md is renamed to progress.md;
//   - the both-exist case is skipped (caller reconciles by hand);
//   - the neither-exists case is a no-op;
//   - dry-run leaves the vault untouched.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/rename-summary-to-progress.mjs");

let vault: string;

beforeEach(async () => {
  vault = mkdtempSync(path.join(os.tmpdir(), "ook-rstp-"));

  await fs.mkdir(path.join(vault, "Alpha"));
  await fs.writeFile(path.join(vault, "Alpha", "summary.md"), "Alpha summary body.\n", "utf8");

  await fs.mkdir(path.join(vault, "Beta"));
  await fs.writeFile(path.join(vault, "Beta", "summary.md"), "Beta summary body.\n", "utf8");
  await fs.writeFile(
    path.join(vault, "Beta", "progress.md"),
    "Beta progress already exists.\n",
    "utf8",
  );

  await fs.mkdir(path.join(vault, "Gamma"));
  // no summary.md, no progress.md
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

describe("rename-summary-to-progress.mjs", () => {
  it("dry-run leaves every file untouched", async () => {
    const res = run([]);
    expect(res.status).toBe(0);
    expect(await fileExists(path.join(vault, "Alpha", "summary.md"))).toBe(true);
    expect(await fileExists(path.join(vault, "Alpha", "progress.md"))).toBe(false);
  });

  it("--apply renames the bare summary.md to progress.md", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    expect(await fileExists(path.join(vault, "Alpha", "summary.md"))).toBe(false);
    expect(await fileExists(path.join(vault, "Alpha", "progress.md"))).toBe(true);
    const content = await fs.readFile(path.join(vault, "Alpha", "progress.md"), "utf8");
    expect(content).toBe("Alpha summary body.\n");
  });

  it("skips the collision case where both files already exist", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    // Both files are left exactly where they were.
    expect(await fileExists(path.join(vault, "Beta", "summary.md"))).toBe(true);
    expect(await fileExists(path.join(vault, "Beta", "progress.md"))).toBe(true);
    const summary = await fs.readFile(path.join(vault, "Beta", "summary.md"), "utf8");
    const progress = await fs.readFile(path.join(vault, "Beta", "progress.md"), "utf8");
    expect(summary).toBe("Beta summary body.\n");
    expect(progress).toBe("Beta progress already exists.\n");
    expect(res.stderr).toContain("Beta");
  });

  it("is a no-op for books without a summary.md", async () => {
    const res = run(["--apply"]);
    expect(res.status).toBe(0);
    expect(await fileExists(path.join(vault, "Gamma", "summary.md"))).toBe(false);
    expect(await fileExists(path.join(vault, "Gamma", "progress.md"))).toBe(false);
  });
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
