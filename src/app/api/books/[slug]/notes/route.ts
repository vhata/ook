import { NextResponse } from "next/server";
import { getBookBySlug } from "@/lib/books";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

// Tier 2 endpoint. Returns raw markdown for the per-book reference notes,
// optionally prefixed with the reader's running notes from `progress.md`
// under a `## Reading notes` heading. Deliberately served from a separate
// route (not the SSR'd page) so search engines never see the deep-spoiler
// content in the initial HTML — only the user's explicit click triggers
// this fetch.
export async function GET(_req: Request, { params }: { params: Params }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const page = await getBookBySlug(decoded);
  if (!page) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ body: assembleNotesBody(page.progress, page.body) });
}

// Compose the tier-2 payload. When `progress.md` is present, prepend it
// under a `## Reading notes` heading so the running notes the reader
// wrote while reading lead the deep-notes payload. When absent, return
// just the reference-notes body. Exported for tests.
export function assembleNotesBody(progress: string | null, body: string): string {
  const ref = body.trim();
  const notes = progress?.trim() ?? "";
  if (!notes) return ref;
  if (!ref) return `## Reading notes\n\n${notes}`;
  return `## Reading notes\n\n${notes}\n\n${ref}`;
}
