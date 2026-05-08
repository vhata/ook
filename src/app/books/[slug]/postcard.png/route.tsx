import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getBookBySlug } from "@/lib/books";
import { loadFont } from "@/lib/og-fonts";

// Per-book postcard PNG at /books/[slug]/postcard.png.
//
// Like the existing /opengraph-image.tsx but standalone (so users can
// share or print the postcard URL directly) and slightly different
// composition: cover floated left, title + author + pullquote on
// the right, postcard-style serif typography. Cached aggressively —
// stable per (slug, frontmatter), so a 1d browser / 7d edge TTL is
// generous.

export const dynamic = "force-dynamic";

export const alt = "ook — book postcard";
const SIZE = { width: 1200, height: 800 };
export const contentType = "image/png";

const COLOR = {
  bg: "#faf7f1",
  surface: "#ffffff",
  ink: "#1c1b18",
  inkSoft: "#6b665d",
  inkDim: "#9a9489",
  rule: "#e3dccb",
  accent: "#a3402a",
  star: "#a3792a",
};

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const page = await getBookBySlug(decoded);
  if (!page) notFound();

  const [serif400, serif500, serifItalic] = await Promise.all([
    loadFont("Source Serif 4", 400),
    loadFont("Source Serif 4", 500),
    loadFont("Source Serif 4", 400, "italic"),
  ]);

  const { book } = page;
  const author = book.authors.join(", ");
  const stars = book.rating !== null ? "★".repeat(Math.floor(book.rating)) : "";
  const halfStar = book.rating !== null && book.rating % 1 >= 0.5 ? "½" : "";
  const dateLine = book.finished
    ? `finished ${book.finished}`
    : book.status === "reading"
      ? `currently reading`
      : book.status;

  const pullquoteText = book.pullquote?.text ?? null;
  const pullquoteSource = book.pullquote?.source ?? null;

  return new ImageResponse(
    <div
      style={{
        ...SIZE,
        display: "flex",
        background: COLOR.bg,
        color: COLOR.ink,
        fontFamily: "Source Serif 4",
        padding: 56,
        position: "relative",
      }}
    >
      {/* Postcard inner card with subtle border */}
      <div
        style={{
          display: "flex",
          flex: 1,
          background: COLOR.surface,
          border: `2px solid ${COLOR.rule}`,
          borderRadius: 6,
          padding: 56,
          position: "relative",
        }}
      >
        {/* Top-right: ook mark */}
        <div
          style={{
            position: "absolute",
            top: 28,
            right: 36,
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            fontSize: 22,
            color: COLOR.inkSoft,
          }}
        >
          <span style={{ fontSize: 30, color: COLOR.ink, fontWeight: 500 }}>
            ook<span style={{ color: COLOR.accent }}>.</span>
          </span>
          <span style={{ color: COLOR.inkDim, fontStyle: "italic" }}>postcard</span>
        </div>

        {/* Cover left */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 280,
            marginRight: 48,
          }}
        >
          {book.cover ? (
            // next/og's ImageResponse runs in its own context where
            // <img> is the correct primitive; next/image isn't
            // available here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.cover}
              width={280}
              height={420}
              style={{
                objectFit: "cover",
                borderRadius: 6,
                boxShadow: "0 18px 48px rgba(28, 27, 24, 0.22)",
              }}
              alt=""
            />
          ) : (
            <div
              style={{
                width: 280,
                height: 420,
                background: COLOR.bg,
                border: `1px solid ${COLOR.rule}`,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: COLOR.inkDim,
                fontSize: 28,
                fontStyle: "italic",
              }}
            >
              no cover
            </div>
          )}
        </div>

        {/* Right column: title, author, pullquote, footer */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            paddingTop: 24,
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: COLOR.inkSoft,
              letterSpacing: 4,
              textTransform: "uppercase",
              marginBottom: 18,
              display: "flex",
              gap: 12,
            }}
          >
            <span>{dateLine}</span>
            {stars && (
              <>
                <span style={{ color: COLOR.inkDim }}>·</span>
                <span style={{ color: COLOR.star, letterSpacing: 0 }}>
                  {stars}
                  {halfStar}
                </span>
              </>
            )}
          </div>

          <div
            style={{
              fontSize: titleFontSize(book.title),
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              marginBottom: 14,
              display: "flex",
            }}
          >
            {book.title}
          </div>

          {author && (
            <div
              style={{
                fontSize: 26,
                color: COLOR.inkSoft,
                marginBottom: 28,
                display: "flex",
              }}
            >
              {author}
            </div>
          )}

          {pullquoteText ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
              <div
                style={{
                  fontSize: 26,
                  color: COLOR.ink,
                  fontStyle: "italic",
                  lineHeight: 1.35,
                  marginBottom: 12,
                  display: "flex",
                }}
              >
                &ldquo;{pullquoteText}&rdquo;
              </div>
              {pullquoteSource && (
                <div style={{ fontSize: 18, color: COLOR.inkSoft, display: "flex" }}>
                  — {pullquoteSource}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                fontSize: 18,
                color: COLOR.inkDim,
                fontStyle: "italic",
                marginTop: "auto",
                display: "flex",
              }}
            >
              {book.series ?? "—"}
            </div>
          )}

          {/* Footer rule + URL */}
          <div
            style={{
              borderTop: `1px solid ${COLOR.rule}`,
              paddingTop: 16,
              marginTop: 32,
              fontSize: 14,
              color: COLOR.inkDim,
              letterSpacing: 2,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>b-ook.vercel.app/books/{book.slug}</span>
            <span>{new Date().toISOString().slice(0, 10)}</span>
          </div>
        </div>
      </div>

      {/* Accent stripe along the bottom, postal-stamp gesture */}
      <div
        style={{
          position: "absolute",
          bottom: 28,
          left: 56,
          right: 56,
          height: 4,
          background: COLOR.accent,
        }}
      />
    </div>,
    {
      ...SIZE,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
      fonts: [
        { name: "Source Serif 4", data: serif400, weight: 400, style: "normal" },
        { name: "Source Serif 4", data: serif500, weight: 500, style: "normal" },
        { name: "Source Serif 4", data: serifItalic, weight: 400, style: "italic" },
      ],
    },
  );
}

function titleFontSize(title: string): number {
  const len = title.length;
  if (len <= 18) return 70;
  if (len <= 28) return 58;
  if (len <= 42) return 48;
  return 40;
}
