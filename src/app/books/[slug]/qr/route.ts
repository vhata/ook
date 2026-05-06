import QRCode from "qrcode";
import { getBookBySlug } from "@/lib/books";
import { SITE_URL } from "@/lib/site";

// Per-book QR endpoint at /books/[slug]/qr. Returns a 512×512 PNG that
// encodes the canonical book URL. Useful as a printable bookmark slip
// (paste into a Word doc, slide into the actual physical book).
//
// The slug is verified against the vault — unknown slugs return 404 so
// the endpoint can't be used to mint QRs for arbitrary URL fragments.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const page = await getBookBySlug(decoded);
  if (!page) return new Response("not found", { status: 404 });

  const target = `${SITE_URL}/books/${encodeURIComponent(decoded)}`;
  const buffer = await QRCode.toBuffer(target, {
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      // Match the site's paper-and-ink palette so the QR doesn't read
      // as a different visual register when stickered onto book covers.
      dark: "#1c1b18",
      light: "#faf7f1",
    },
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      // Aggressive caching is fine — slug → URL is stable for the life
      // of the slug, and the QR pixels are pure deterministic output.
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}
