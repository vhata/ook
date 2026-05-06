import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { reindex } from "../../src/lib/store/index-vault";
import { MemoryStore, keys, setStore } from "../../src/lib/store";

const FIXTURE_VAULT = path.resolve(__dirname, "..", "fixtures", "vault");

beforeEach(() => {
  vi.stubEnv("BOOKS_DIR", FIXTURE_VAULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setStore(null);
});

describe("reindex", () => {
  it("populates book:{slug} keys + books:index from the vault", async () => {
    const store = new MemoryStore();
    setStore(store);
    const result = await reindex(store);
    expect(result.books).toBe(2);
    const slugs = (await store.smembers(keys.booksIndex())).sort();
    expect(slugs).toEqual(["PrivateBook", "TestBook"]);
    const test = await store.get<{ title: string }>(keys.book("TestBook"));
    expect(test?.title).toBe("Test Book");
  });

  it("populates bingo:{year} keys + bingo:years for every card on disk", async () => {
    const store = new MemoryStore();
    setStore(store);
    const result = await reindex(store);
    expect(result.bingoCards).toBe(2);
    const years = (await store.smembers(keys.bingoYears())).map(Number).sort();
    expect(years).toEqual([2025, 2026]);
    const card2026 = await store.get<{ year: number }>(keys.bingo(2026));
    expect(card2026?.year).toBe(2026);
  });

  it("clears stale book entries on reindex", async () => {
    const store = new MemoryStore();
    setStore(store);
    // Pre-seed an old book that no longer exists in the vault.
    await store.set(keys.book("DeletedBook"), { title: "Gone" });
    await store.sadd(keys.booksIndex(), "DeletedBook");

    await reindex(store);
    expect(await store.get(keys.book("DeletedBook"))).toBeNull();
    const slugs = await store.smembers(keys.booksIndex());
    expect(slugs).not.toContain("DeletedBook");
  });

  it("returns a removal count covering both kv and set sweeps", async () => {
    const store = new MemoryStore();
    setStore(store);
    // First reindex from cold — nothing to remove.
    const first = await reindex(store);
    expect(first.removed).toBe(0);
    // Second reindex against the same store — every key is wiped and
    // rewritten, so the count reflects what got cleared.
    const second = await reindex(store);
    expect(second.removed).toBeGreaterThan(0);
  });
});
