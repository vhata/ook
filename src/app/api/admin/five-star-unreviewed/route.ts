import { getFiveStarUnreviewed, pickOne } from "@/lib/admin/five-star-unreviewed";

// GET /api/admin/five-star-unreviewed — returns ONE candidate from the
// pool of `status: finished + rating: 5 + no review.md` books, skipping
// any slugs in the comma-separated `exclude` query param.
//
// Backs the opportunistic single-question prompt that the /admin
// AdminConsole surfaces when the agent has staged a patch and the user
// is about to commit. The client tracks offered/skipped slugs in
// component state and threads them through `exclude` so the helper
// keeps walking the pool until it runs out (one ask per book per
// session) — then returns `{ candidate: null }` and the prompt stays
// hidden until tab close clears the state.
//
// **Auth:** gated by `src/proxy.ts`. No payload smaller than the public
// catalog is leaked — every field returned here is already rendered on
// the public per-book page.

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const excludeRaw = url.searchParams.get("exclude") ?? "";
  const excluding = new Set(
    excludeRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

  const candidates = await getFiveStarUnreviewed();
  const candidate = pickOne(candidates, excluding);
  return Response.json({ candidate });
}
