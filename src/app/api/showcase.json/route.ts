import { getShowcase } from "@/lib/showcase";

// Public, unauthenticated reading-showcase feed consumed server-side by the
// owner's personal site (vhata.net). Everything here is already public on
// ook. The payload shape is a contract — see `src/lib/showcase.ts`.
//
// `force-dynamic` keeps the body fresh per request; the `s-maxage` header
// lets Vercel's CDN serve a cached copy for ~5 minutes between origin hits,
// matching vhata's ISR revalidate window.

export const dynamic = "force-dynamic";

export async function GET() {
  const showcase = await getShowcase();

  return Response.json(showcase, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
      // vhata fetches server-side, so CORS isn't strictly needed, but a
      // wildcard is harmless and lets the endpoint be hit from the browser.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
