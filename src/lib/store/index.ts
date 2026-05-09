import { MemoryStore } from "./memory";
import { UpstashStore } from "./upstash";
import type { Store } from "./types";

export type { Store } from "./types";
export { MemoryStore } from "./memory";
export { UpstashStore } from "./upstash";

// Module-level singleton so all callers within a single Lambda
// invocation share the same in-process state. On Vercel Fluid Compute
// this also amortises across concurrent requests on the same instance.
let _store: Store | null = null;

// Override hook for tests — `setStore(new MemoryStore())` lets a test
// pin a fresh adapter for the duration of a test, avoiding shared state
// across test files.
export function setStore(store: Store | null): void {
  _store = store;
}

// Returns the active store. Picks the Upstash adapter when both env
// vars are present; otherwise falls back to in-memory. The fallback is
// noisy on purpose — in production we want to know if Upstash isn't
// wired up rather than silently losing writes on every cold start.
//
// Vercel Marketplace Upstash provisioning historically injected the
// canonical `UPSTASH_REDIS_REST_*` names but newer integrations inject
// only the Vercel-KV-compatible `KV_REST_API_*` aliases (same credentials,
// different keys). Try both, with the canonical names winning when both
// are present.
export function getStore(): Store {
  if (_store) return _store;

  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    _store = new UpstashStore(url, token);
    return _store;
  }

  if (process.env.NODE_ENV === "production" && process.env.OOK_ALLOW_MEMORY_STORE !== "1") {
    // Loud fail: production without Upstash means the MCP write surface
    // is broken on every cold start. Better to surface this immediately
    // than let writes silently disappear.
    throw new Error(
      "Store not configured: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN " +
        "(or the Vercel-KV-compat aliases KV_REST_API_URL + KV_REST_API_TOKEN; " +
        "Marketplace Upstash provisioning typically injects the latter pair). " +
        "Set OOK_ALLOW_MEMORY_STORE=1 only if you really want the in-memory adapter in production.",
    );
  }

  _store = new MemoryStore();
  return _store;
}

// Key helpers — keep all key shapes in one place so a typo in one
// caller doesn't quietly create a parallel keyspace. Treat these as
// the schema; if you add a new key family, add it here.
export const keys = {
  book: (slug: string) => `book:${slug}`,
  bingo: (year: number) => `bingo:${year}`,
  booksIndex: () => `books:index`,
  bingoYears: () => `bingo:years`,

  // Auth keys.
  authChallenge: (id: string) => `auth:challenge:${id}`,
  authCredentials: () => `auth:credentials`,
  authBackupCodeHash: () => `auth:backup-code-hash`,
};
