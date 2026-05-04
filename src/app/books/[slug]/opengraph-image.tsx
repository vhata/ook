import { ImageResponse } from "next/og";
import { getBookBySlug } from "@/lib/books";
import { loadFont } from "@/lib/og-fonts";

export const alt = "ook — a reading journal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Site palette (paper / ink / rust). Inlined from globals.css so the OG
// route is self-contained; if the palette shifts there, mirror it here.
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

export default async function BookOpenGraphImage({ params }: Params) {
  const { slug } = await params;
  const page = await getBookBySlug(decodeURIComponent(slug));

  const [serif400, serif500, serifItalic] = await Promise.all([
    loadFont("Source Serif 4", 400),
    loadFont("Source Serif 4", 500),
    loadFont("Source Serif 4", 400, "italic"),
  ]);

  // Defensive fallback for an unknown slug — Next will still call this if
  // /books/<slug> 404s. Render a clean "not found" card rather than throw.
  if (!page) {
    return new ImageResponse(
      <div
        style={{
          ...size,
          display: "flex",
          background: COLOR.bg,
          color: COLOR.ink,
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Source Serif 4",
          fontSize: 64,
        }}
      >
        ook
        <span style={{ color: COLOR.accent }}>.</span>
      </div>,
      { ...size, fonts: ogFonts(serif400, serif500, serifItalic) },
    );
  }

  const { book } = page;
  const author = book.authors[0] ?? "";
  const stars = book.rating !== null ? "★".repeat(Math.floor(book.rating)) : "";
  const halfStar = book.rating !== null && book.rating % 1 >= 0.5 ? "½" : "";

  return new ImageResponse(
    <div
      style={{
        ...size,
        display: "flex",
        background: COLOR.bg,
        color: COLOR.ink,
        fontFamily: "Source Serif 4",
        position: "relative",
      }}
    >
      {/* Accent stripe along the top */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          background: COLOR.accent,
        }}
      />

      {/* Cover (left) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 40px 60px 80px",
          width: 480,
        }}
      >
        {book.cover ? (
          <img
            src={book.cover}
            width={360}
            height={540}
            style={{
              objectFit: "cover",
              borderRadius: 8,
              boxShadow: "0 12px 40px rgba(28, 27, 24, 0.18)",
            }}
            alt=""
          />
        ) : (
          <div
            style={{
              width: 360,
              height: 540,
              background: COLOR.surface,
              border: `1px solid ${COLOR.rule}`,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: COLOR.inkDim,
              fontSize: 24,
              fontStyle: "italic",
            }}
          >
            no cover
          </div>
        )}
      </div>

      {/* Details (right) */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "70px 80px 70px 0",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Status / rating row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: COLOR.inkSoft,
              fontSize: 18,
              letterSpacing: 3,
              textTransform: "uppercase",
              marginBottom: 32,
            }}
          >
            <span style={{ color: book.status === "reading" ? COLOR.accent : COLOR.star }}>
              {book.status}
            </span>
            {stars && (
              <>
                <span style={{ color: COLOR.inkDim }}>·</span>
                <span style={{ color: COLOR.star, letterSpacing: 0 }}>
                  {stars}
                  {halfStar}
                </span>
              </>
            )}
            {book.finished && (
              <>
                <span style={{ color: COLOR.inkDim }}>·</span>
                <span>{book.finished}</span>
              </>
            )}
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: titleFontSize(book.title),
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              marginBottom: 18,
              display: "flex",
            }}
          >
            {book.title}
          </div>

          {/* Author */}
          {author && (
            <div
              style={{
                fontSize: 30,
                color: COLOR.inkSoft,
                display: "flex",
              }}
            >
              {book.authors.length > 1 ? `${author} et al.` : author}
            </div>
          )}

          {/* Series / pullquote teaser */}
          {book.series && (
            <div
              style={{
                fontSize: 20,
                color: COLOR.inkDim,
                fontStyle: "italic",
                marginTop: 14,
                display: "flex",
              }}
            >
              {book.series}
            </div>
          )}
        </div>

        {/* Footer: site mark */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            fontSize: 22,
            color: COLOR.inkSoft,
            borderTop: `1px solid ${COLOR.rule}`,
            paddingTop: 22,
          }}
        >
          <span style={{ fontSize: 36, color: COLOR.ink, fontWeight: 500 }}>
            ook<span style={{ color: COLOR.accent }}>.</span>
          </span>
          <span style={{ color: COLOR.inkDim, marginLeft: 10 }}>a reading journal</span>
        </div>
      </div>
    </div>,
    { ...size, fonts: ogFonts(serif400, serif500, serifItalic) },
  );
}

// Picks a title size that doesn't blow out of the right pane for very long
// titles. Tuned by eye for the 640px-wide title column.
function titleFontSize(title: string): number {
  const len = title.length;
  if (len <= 18) return 78;
  if (len <= 28) return 64;
  if (len <= 42) return 52;
  return 44;
}

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style?: "normal" | "italic";
};

function ogFonts(regular: ArrayBuffer, medium: ArrayBuffer, italic: ArrayBuffer): OgFont[] {
  return [
    { name: "Source Serif 4", data: regular, weight: 400, style: "normal" },
    { name: "Source Serif 4", data: medium, weight: 500, style: "normal" },
    { name: "Source Serif 4", data: italic, weight: 400, style: "italic" },
  ];
}
