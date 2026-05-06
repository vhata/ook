import { reindex } from "@/lib/store/index-vault";

// POST /api/admin/reindex — rebuilds the store's view of the vault.
//
// Triggered by the GitHub webhook on `vhata/books` (configured to call
// this endpoint in addition to the existing Vercel deploy hook), or
// manually from the /admin UI.
//
// **Auth:** the route is gated by the global auth middleware that
// covers /api/mcp/* and /admin (see src/middleware.ts once the auth
// task lands). Until that lands, requests to this endpoint will be
// rejected unless they carry a valid session cookie.

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const result = await reindex();
  return Response.json({ ok: true, ...result });
}

// GET returns metadata about the current index — counts only, no data
// — so an admin can sanity-check freshness without triggering a
// rebuild. Useful in the /admin UI as a "last reindexed" indicator.
export async function GET(): Promise<Response> {
  // Don't import getStore at module top level — we want the test
  // override to apply if a test-installed adapter is in place.
  const { getStore, keys } = await import("@/lib/store");
  const store = getStore();
  const [bookSlugs, bingoYears] = await Promise.all([
    store.smembers(keys.booksIndex()),
    store.smembers(keys.bingoYears()),
  ]);
  return Response.json({
    books: bookSlugs.length,
    bingoYears: bingoYears.map(Number).sort((a, b) => b - a),
  });
}
