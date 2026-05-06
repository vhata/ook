import { Redis } from "@upstash/redis";
import type { Store } from "./types";

// Upstash REST adapter. Reads UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN at construction time. The Marketplace
// integration on Vercel auto-injects these.
//
// Behavioural parity with MemoryStore: values are JSON-serialised on
// set, parsed on get. Upstash's TS client already does its own JSON
// round-tripping for objects, but doing it ourselves keeps the contract
// stable across adapters.

export class UpstashStore implements Store {
  private redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get<string>(key);
    if (raw === null || raw === undefined) return null;
    // Upstash auto-parses if the original input was an object; our
    // contract is "we stored a JSON string", so handle both shapes.
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    }
    return raw as T;
  }

  async set<T>(key: string, value: T, opts?: { ttlSeconds?: number }): Promise<void> {
    const serialised = JSON.stringify(value);
    if (opts?.ttlSeconds) {
      await this.redis.set(key, serialised, { ex: opts.ttlSeconds });
    } else {
      await this.redis.set(key, serialised);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async sadd(key: string, ...members: string[]): Promise<void> {
    if (members.length === 0) return;
    await this.redis.sadd(key, members[0], ...members.slice(1));
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    if (members.length === 0) return;
    await this.redis.srem(key, members[0], ...members.slice(1));
  }

  async smembers(key: string): Promise<string[]> {
    return await this.redis.smembers(key);
  }

  async delByPrefix(prefix: string): Promise<number> {
    // SCAN-and-delete in batches. Upstash doesn't support DEL with a
    // pattern, so we walk the key space ourselves. Upstash returns the
    // cursor as a string; "0" is the terminal sentinel.
    let cursor = "0";
    let removed = 0;
    do {
      const result: [string, string[]] = await this.redis.scan(cursor, {
        match: `${prefix}*`,
        count: 200,
      });
      cursor = result[0];
      const batch = result[1];
      if (batch.length > 0) {
        await this.redis.del(...batch);
        removed += batch.length;
      }
    } while (cursor !== "0");
    return removed;
  }
}
