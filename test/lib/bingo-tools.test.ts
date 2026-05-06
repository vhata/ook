// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bindBookToBingoSquare } from "../../src/lib/mcp/bingo-tools";
import { reindex } from "../../src/lib/store/index-vault";
import { MemoryStore, setStore } from "../../src/lib/store";
import yaml from "js-yaml";

const FIXTURE_SRC = path.resolve(__dirname, "..", "fixtures", "vault");

let workingVault: string;

beforeEach(() => {
  workingVault = mkdtempSync(path.join(tmpdir(), "ook-bingo-tools-"));
  cpSync(FIXTURE_SRC, workingVault, { recursive: true });
  vi.stubEnv("BOOKS_DIR", workingVault);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setStore(null);
  rmSync(workingVault, { recursive: true, force: true });
});

function readBingoSquares(year: number): Array<Record<string, unknown>> {
  const raw = readFileSync(path.join(workingVault, "_meta", `bingo-${year}.md`), "utf8");
  const between = raw.split("---")[1];
  const data = yaml.load(between) as { squares: Array<Record<string, unknown>> };
  return data.squares;
}

describe("bindBookToBingoSquare", () => {
  it("sets the book on a square that wasn't bound", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await bindBookToBingoSquare({
      year: 2026,
      square_id: "a3",
      book_slug: "TestBook",
      commit_message: "Bind TestBook to a3",
    });
    const squares = readBingoSquares(2026);
    const a3 = squares.find((s) => s.id === "a3");
    expect(a3?.book).toBe("TestBook");
  });

  it("clears the book when book_slug is null", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await bindBookToBingoSquare({
      year: 2026,
      square_id: "a1",
      book_slug: null,
      commit_message: "Unbind a1",
    });
    const squares = readBingoSquares(2026);
    const a1 = squares.find((s) => s.id === "a1");
    expect(a1?.book).toBeNull();
  });

  it("refuses to bind to the free square", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await expect(
      bindBookToBingoSquare({
        year: 2026,
        square_id: "b2",
        book_slug: "TestBook",
        commit_message: "x",
      }),
    ).rejects.toThrow(/free square/);
  });

  it("refuses to bind a slug that isn't in the store", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await expect(
      bindBookToBingoSquare({
        year: 2026,
        square_id: "a3",
        book_slug: "NoSuchBook",
        commit_message: "x",
      }),
    ).rejects.toThrow(/not found in the store/);
  });

  it("404s for an unknown bingo year", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await expect(
      bindBookToBingoSquare({
        year: 1999,
        square_id: "a1",
        book_slug: null,
        commit_message: "x",
      }),
    ).rejects.toThrow(/not found for year 1999/);
  });

  it("optimistically updates the cached bingo card in the store", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await bindBookToBingoSquare({
      year: 2026,
      square_id: "a3",
      book_slug: "TestBook",
      commit_message: "x",
    });
    const cached = await store.get<{ squares: Array<{ id: string; book: string | null }> }>(
      "bingo:2026",
    );
    const a3 = cached?.squares.find((s) => s.id === "a3");
    expect(a3?.book).toBe("TestBook");
  });
});
