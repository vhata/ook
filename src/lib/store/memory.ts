import type { Store } from "./types";

// In-process store adapter. Default when UPSTASH_* env vars are unset.
// Used in tests, local dev (when Upstash isn't provisioned), and as a
// behavioural reference implementation for the Upstash adapter.
//
// Caveats: data is lost on every server restart. Each Vercel function
// invocation gets a fresh module if the runtime cold-starts. So for any
// production use, the Upstash adapter is mandatory — this one is for
// development ergonomics.
//
// JSON-serialises values on set so the adapter behaves identically to
// the Upstash one (which round-trips through JSON over HTTP). Catches
// drift bugs early — e.g. a Date that survives the memory store but not
// the network round-trip.

type Entry = {
  value: string;
  expiresAt: number | null;
};

export class MemoryStore implements Store {
  private kv = new Map<string, Entry>();
  private sets = new Map<string, Set<string>>();

  private now() {
    return Date.now();
  }

  private alive(entry: Entry): boolean {
    if (entry.expiresAt === null) return true;
    return entry.expiresAt > this.now();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (!this.alive(entry)) {
      this.kv.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }

  async set<T>(key: string, value: T, opts?: { ttlSeconds?: number }): Promise<void> {
    const expiresAt = opts?.ttlSeconds ? this.now() + opts.ttlSeconds * 1000 : null;
    this.kv.set(key, { value: JSON.stringify(value), expiresAt });
  }

  async del(key: string): Promise<void> {
    this.kv.delete(key);
    this.sets.delete(key);
  }

  async sadd(key: string, ...members: string[]): Promise<void> {
    if (members.length === 0) return;
    let s = this.sets.get(key);
    if (!s) {
      s = new Set();
      this.sets.set(key, s);
    }
    for (const m of members) s.add(m);
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    const s = this.sets.get(key);
    if (!s) return;
    for (const m of members) s.delete(m);
  }

  async smembers(key: string): Promise<string[]> {
    const s = this.sets.get(key);
    if (!s) return [];
    return [...s];
  }

  async delByPrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const k of [...this.kv.keys()]) {
      if (k.startsWith(prefix)) {
        this.kv.delete(k);
        removed++;
      }
    }
    for (const k of [...this.sets.keys()]) {
      if (k.startsWith(prefix)) {
        this.sets.delete(k);
        removed++;
      }
    }
    return removed;
  }
}
