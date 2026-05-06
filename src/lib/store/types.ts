// Store abstraction. The MCP write surface needs durable, low-latency
// access to a few derived shapes — book records, the bingo cards, the
// books index, WebAuthn credentials, registration challenges. The vault
// stays the source of truth on disk; the store is a materialised view
// plus auth state.
//
// Two adapters live behind this interface: a memory adapter (default,
// used in tests and as a local-dev fallback) and an Upstash Redis
// adapter (production). The interface is deliberately thin — JSON
// values keyed by string, plus set-of-strings semantics for the books
// index. Anything more exotic and we'd be coupling to a specific
// backend.

export type Store = {
  // Read a JSON value. Returns null when the key is absent.
  get<T>(key: string): Promise<T | null>;

  // Write a JSON value. Optional TTL in seconds; no TTL means durable.
  set<T>(key: string, value: T, opts?: { ttlSeconds?: number }): Promise<void>;

  // Remove a key. Idempotent; missing keys are a no-op.
  del(key: string): Promise<void>;

  // Set-of-strings semantics. Used for `books:index` and similar
  // membership queries where we don't need the value, just the slug.
  sadd(key: string, ...members: string[]): Promise<void>;
  srem(key: string, ...members: string[]): Promise<void>;
  smembers(key: string): Promise<string[]>;

  // Bulk delete by prefix. Required when reindexing — nuke every
  // book:* key so a deleted book from the vault doesn't linger.
  // Implementations may use SCAN under the hood; the contract is the
  // observable behaviour, not the mechanism.
  delByPrefix(prefix: string): Promise<number>;
};
