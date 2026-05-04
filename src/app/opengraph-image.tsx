import { ImageResponse } from "next/og";
import { getCurrentlyReading, getRecentlyFinished } from "@/lib/books";
import { loadFont } from "@/lib/og-fonts";

export const alt = "ook — a reading journal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLOR = {
  bg: "#faf7f1",
  ink: "#1c1b18",
  inkSoft: "#6b665d",
  inkDim: "#9a9489",
  rule: "#e3dccb",
  accent: "#a3402a",
  star: "#a3792a",
};

export default async function HomeOpenGraphImage() {
  const [serif400, serif500, serifItalic, reading, finished] = await Promise.all([
    loadFont("Source Serif 4", 400),
    loadFont("Source Serif 4", 500),
    loadFont("Source Serif 4", 400, "italic"),
    getCurrentlyReading(),
    getRecentlyFinished(1),
  ]);
  const now = reading[0] ?? null;
  const last = finished[0] ?? null;

  return new ImageResponse(
    <div
      style={{
        ...size,
        display: "flex",
        flexDirection: "column",
        background: COLOR.bg,
        color: COLOR.ink,
        fontFamily: "Source Serif 4",
        padding: "80px 96px",
        position: "relative",
      }}
    >
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

      {/* Mast */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 22,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: 144,
            fontWeight: 500,
            letterSpacing: -4,
            lineHeight: 0.92,
            display: "flex",
          }}
        >
          ook<span style={{ color: COLOR.accent }}>.</span>
        </div>
      </div>

      <div
        style={{
          fontSize: 30,
          color: COLOR.inkSoft,
          fontStyle: "italic",
          marginBottom: 60,
          display: "flex",
        }}
      >
        What I&rsquo;m reading, what I&rsquo;ve finished, and the bingo card I&rsquo;m chasing.
      </div>

      {/* Now / last cards */}
      <div
        style={{
          display: "flex",
          gap: 36,
          borderTop: `1px solid ${COLOR.rule}`,
          paddingTop: 40,
          marginTop: "auto",
        }}
      >
        <Slot
          label="Reading now"
          labelColor={COLOR.accent}
          title={now?.title ?? "Nothing on the desk"}
          author={now?.authors[0] ?? null}
          empty={!now}
        />
        <Slot
          label="Last finished"
          labelColor={COLOR.star}
          title={last?.title ?? "—"}
          author={last?.authors[0] ?? null}
          empty={!last}
        />
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Source Serif 4", data: serif400, weight: 400, style: "normal" },
        { name: "Source Serif 4", data: serif500, weight: 500, style: "normal" },
        { name: "Source Serif 4", data: serifItalic, weight: 400, style: "italic" },
      ],
    },
  );
}

function Slot({
  label,
  labelColor,
  title,
  author,
  empty,
}: {
  label: string;
  labelColor: string;
  title: string;
  author: string | null;
  empty: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          fontSize: 16,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: labelColor,
          marginBottom: 14,
          display: "flex",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: title.length > 28 ? 32 : 40,
          fontWeight: 500,
          letterSpacing: -1,
          lineHeight: 1.1,
          color: empty ? COLOR.inkDim : COLOR.ink,
          fontStyle: empty ? "italic" : "normal",
          display: "flex",
        }}
      >
        {title}
      </div>
      {author && (
        <div
          style={{
            fontSize: 22,
            color: COLOR.inkSoft,
            marginTop: 8,
            display: "flex",
          }}
        >
          {author}
        </div>
      )}
    </div>
  );
}
