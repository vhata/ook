import { reindex, type LastReindex } from "@/lib/store/index-vault";

// POST /api/admin/reindex — rebuilds the store's view of the vault
// from the current vault filesystem.
//
// Manual path: the /admin UI's Reindex button. The webhook path lives
// at /api/webhooks/books/reindex and stamps `source: webhook` instead.
//
// **Auth:** gated by `src/proxy.ts`, which requires a valid session
// cookie on /api/admin/* routes.

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const result = await reindex(undefined, "admin");
  return Response.json({ ok: true, ...result });
}

// GET returns metadata about the current index — counts only, no data
// — plus the `lastReindex` record (timestamp + source) so the /admin
// UI can show "last refreshed N min ago via webhook". An admin can
// sanity-check freshness without triggering a rebuild.
export async function GET(): Promise<Response> {
  // Don't import getStore at module top level — we want the test
  // override to apply if a test-installed adapter is in place.
  const { getStore, keys } = await import("@/lib/store");
  const store = getStore();
  const [bookSlugs, bingoYears, lastReindex] = await Promise.all([
    store.smembers(keys.booksIndex()),
    store.smembers(keys.bingoYears()),
    store.get<LastReindex>(keys.lastReindex()),
  ]);
  return Response.json({
    books: bookSlugs.length,
    bingoYears: bingoYears.map(Number).sort((a, b) => b - a),
    lastReindex,
  });
}
