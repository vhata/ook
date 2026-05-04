import { NextResponse } from "next/server";
import { getBookBySlug } from "@/lib/books";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

// Tier 2 endpoint. Returns raw markdown for the per-book reference notes.
// Deliberately served from a separate route (not the SSR'd page) so search
// engines never see the deep-spoiler content in the initial HTML — only
// the user's explicit click triggers this fetch.
export async function GET(_req: Request, { params }: { params: Params }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const page = await getBookBySlug(decoded);
  if (!page) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ body: page.body });
}
