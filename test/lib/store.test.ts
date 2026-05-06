import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore, getStore, setStore } from "../../src/lib/store";

afterEach(() => {
  setStore(null);
});

describe("MemoryStore", () => {
  it("round-trips a JSON value through set/get", async () => {
    const store = new MemoryStore();
    await store.set("k", { a: 1, b: "two" });
    expect(await store.get("k")).toEqual({ a: 1, b: "two" });
  });

  it("returns null for absent keys", async () => {
    const store = new MemoryStore();
    expect(await store.get("missing")).toBeNull();
  });

  it("respects TTL — value expires after the deadline", async () => {
    const store = new MemoryStore();
    const realNow = Date.now;
    const t0 = 1_700_000_000_000;
    let now = t0;
    Date.now = () => now;
    try {
      await store.set("k", "v", { ttlSeconds: 5 });
      now = t0 + 4_999;
      expect(await store.get("k")).toBe("v");
      now = t0 + 5_001;
      expect(await store.get("k")).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("supports set membership: sadd/smembers/srem", async () => {
    const store = new MemoryStore();
    await store.sadd("members", "a", "b", "c");
    expect((await store.smembers("members")).sort()).toEqual(["a", "b", "c"]);
    await store.srem("members", "b");
    expect((await store.smembers("members")).sort()).toEqual(["a", "c"]);
  });

  it("delByPrefix removes both kv and set keys", async () => {
    const store = new MemoryStore();
    await store.set("book:Ra", { title: "Ra" });
    await store.set("book:Piranesi", { title: "Piranesi" });
    await store.set("bingo:2026", { year: 2026 });
    await store.sadd("books:index", "Ra", "Piranesi");

    const removed = await store.delByPrefix("book");
    // book:Ra, book:Piranesi, bingo:2026, books:index — all start with "b" prefix? No: "book"
    // Actually "book" matches book:Ra, book:Piranesi, books:index, bingo:2026? Let's see —
    // "book" prefix matches "book:Ra", "book:Piranesi", "books:index" (yes, "books" starts
    // with "book"), but NOT "bingo:2026". So removed should be 3.
    expect(removed).toBe(3);
    expect(await store.get("book:Ra")).toBeNull();
    expect(await store.get("bingo:2026")).toEqual({ year: 2026 });
  });
});

describe("getStore", () => {
  it("falls back to MemoryStore when Upstash env vars are absent", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    setStore(null);
    const store = getStore();
    expect(store).toBeInstanceOf(MemoryStore);
  });

  it("respects the test override via setStore()", async () => {
    const fake = new MemoryStore();
    setStore(fake);
    expect(getStore()).toBe(fake);
  });
});
