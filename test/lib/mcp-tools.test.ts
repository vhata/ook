import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { listBingo, listBooks } from "../../src/lib/mcp/tools";
import { reindex } from "../../src/lib/store/index-vault";
import { MemoryStore, setStore } from "../../src/lib/store";

const FIXTURE_VAULT = path.resolve(__dirname, "..", "fixtures", "vault");

beforeEach(() => {
  vi.stubEnv("BOOKS_DIR", FIXTURE_VAULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setStore(null);
});

describe("listBooks (MCP tool)", () => {
  it("returns slim summaries for every indexed book", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    const out = await listBooks({});
    expect(out.map((b) => b.slug).sort()).toEqual(["PrivateBook", "TestBook"]);
    const test = out.find((b) => b.slug === "TestBook");
    expect(test).toMatchObject({
      title: "Test Book",
      author: "Author One",
      status: "finished",
      year: 2026,
    });
  });

  it("filters by status", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    const reading = await listBooks({ status: "reading" });
    expect(reading.map((b) => b.slug)).toEqual(["PrivateBook"]);
    const finished = await listBooks({ status: "finished" });
    expect(finished.map((b) => b.slug)).toEqual(["TestBook"]);
  });

  it("filters by year (finish year)", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    expect((await listBooks({ year: 2026 })).map((b) => b.slug)).toEqual(["TestBook"]);
    expect(await listBooks({ year: 1999 })).toEqual([]);
  });

  it("filters by author substring (case-insensitive)", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    expect((await listBooks({ author: "AUTHOR ONE" })).map((b) => b.slug)).toEqual(["TestBook"]);
    expect(await listBooks({ author: "no-such-author" })).toEqual([]);
  });

  it("filters by tag", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    expect((await listBooks({ tag: "scifi" })).map((b) => b.slug)).toEqual(["TestBook"]);
    expect(await listBooks({ tag: "no-tag" })).toEqual([]);
  });

  it("returns most-recently-finished first, ties by title", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    const out = await listBooks({});
    // TestBook (finished 2026-02-20) before PrivateBook (no finish date).
    expect(out[0].slug).toBe("TestBook");
  });
});

describe("listBingo (MCP tool)", () => {
  it("returns the parsed bingo card for the given year", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    const card = await listBingo({ year: 2026 });
    expect(card?.year).toBe(2026);
    expect(card?.squares).toHaveLength(9);
  });

  it("returns null for an unknown year", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    expect(await listBingo({ year: 1999 })).toBeNull();
  });
});
