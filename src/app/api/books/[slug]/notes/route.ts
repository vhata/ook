import { NextResponse } from "next/server";
import { getBookBySlug } from "@/lib/books";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

// Tier 2 endpoint. Returns raw markdown for the per-book reference notes,
// optionally prefixed with the full plot recap from `summary.md` under a
// `## Plot summary` heading. Deliberately served from a separate route
// (not the SSR'd page) so search engines never see the deep-spoiler
// content in the initial HTML — only the user's explicit click triggers
// this fetch.
export async function GET(_req: Request, { params }: { params: Params }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const page = await getBookBySlug(decoded);
  if (!page) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ body: assembleNotesBody(page.summary, page.body) });
}

// Compose the tier-2 payload. When `summary.md` is present, prepend it
// under a `## Plot summary` heading so the historical plot recap reads
// as the first section of the deep notes. When absent, return just the
// reference-notes body. Exported for tests.
export function assembleNotesBody(summary: string | null, body: string): string {
  const ref = body.trim();
  const sum = summary?.trim() ?? "";
  if (!sum) return ref;
  if (!ref) return `## Plot summary\n\n${sum}`;
  return `## Plot summary\n\n${sum}\n\n${ref}`;
}
