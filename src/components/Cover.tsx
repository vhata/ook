import type { Book } from "@/lib/types";

type Props = {
  src: string | null;
  title: string;
  width: number | string;
  height: number | string;
  rounded?: number;
};

export function Cover({ src, title, width, height, rounded = 2 }: Props) {
  return (
    <div
      className="bg-surface-mute relative shrink-0 overflow-hidden shadow-[0_4px_14px_rgba(0,0,0,0.18)]"
      style={{ width, height, borderRadius: rounded }}
    >
      {src ? (
        <div
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${src})` }}
        />
      ) : (
        <ProceduralCover title={title} />
      )}
    </div>
  );
}

// Eight cover-spine colours — same palette as /shelf for visual
// continuity. Saturated enough to read against the paper background,
// muted enough to sit beside real cover art without yelling.
const COVER_PALETTE = [
  { fill: "#8a4f3a", grain: "#a86244" }, // rust-brown
  { fill: "#7e6a3e", grain: "#9a834c" }, // ochre
  { fill: "#3f6a4a", grain: "#4f835a" }, // forest
  { fill: "#3a5a78", grain: "#4a6f8e" }, // slate-blue
  { fill: "#5e3f6a", grain: "#754f83" }, // plum
  { fill: "#7e3f4a", grain: "#9a4f5c" }, // garnet
  { fill: "#5e6a3f", grain: "#76834f" }, // olive
  { fill: "#3f5a5e", grain: "#4f7378" }, // teal
];

function paletteFor(title: string): (typeof COVER_PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return COVER_PALETTE[Math.abs(hash) % COVER_PALETTE.length];
}

// Pull 1-2 dominant initials from the title for the centred glyph.
// Skips common articles ("the", "a", "an") so "The Will of the Many"
// becomes "WM" rather than "TW". Falls back to the first character
// when nothing else parses.
function initialsFor(title: string): string {
  const words = title
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z]+/, ""))
    .filter((w) => w.length > 0 && !/^(the|a|an|of|and|in|on|to)$/i.test(w));
  if (words.length === 0) return (title.trim()[0] ?? "•").toUpperCase();
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// Procedural placeholder cover for books without a `cover:` URL.
// Hashed-colour background, oversized initials, title in small caps
// at the bottom. Reads as intentional rather than missing-data.
function ProceduralCover({ title }: { title: string }) {
  const palette = paletteFor(title);
  const initials = initialsFor(title);
  const tone = initials.length > 1 ? "tracking-[0.05em]" : "";
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 78 100"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={`grad-${hashId(title)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.grain} />
          <stop offset="100%" stopColor={palette.fill} />
        </linearGradient>
      </defs>
      <rect width="78" height="100" fill={`url(#grad-${hashId(title)})`} />
      {/* Top + bottom decorative bands */}
      <rect x="0" y="6" width="78" height="0.6" fill="rgba(255,255,255,0.3)" />
      <rect x="0" y="93" width="78" height="0.6" fill="rgba(255,255,255,0.3)" />
      {/* Initials */}
      <text
        x="39"
        y="52"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="ui-serif, serif"
        fontSize={initials.length > 1 ? 30 : 38}
        fontWeight="500"
        fill="rgba(255,255,255,0.92)"
        className={tone}
      >
        {initials}
      </text>
      {/* Title — small caps at the foot. Two SVG <text> lines so we
          don't have to wrestle <foreignObject> typing. */}
      {wrapTitle(title, 18).map((line, i) => (
        <text
          key={i}
          x="39"
          y={80 + i * 6}
          textAnchor="middle"
          fontFamily="ui-serif, serif"
          fontSize="4.6"
          letterSpacing="0.4"
          fill="rgba(255,255,255,0.85)"
        >
          {line.toUpperCase()}
        </text>
      ))}
    </svg>
  );
}

// Stable per-title gradient ID. Just needs to be unique within a
// rendered DOM — collisions across different titles are fine since
// the gradient stops use the same palette indices.
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h).toString(36).slice(0, 6);
}

// Word-aware wrap into at most 2 lines, ~18 chars wide. Tuned to fit
// the procedural cover's 78px viewBox at small caps. Truncates with
// an ellipsis if the title spills past line two.
function wrapTitle(title: string, width: number): string[] {
  const words = title.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= 2) break;
    }
  }
  if (current && lines.length < 2) lines.push(current);
  if (lines.length === 2 && words.length > 0) {
    // If we didn't fit everything, add an ellipsis to line 2.
    const consumed = lines.join(" ").split(/\s+/).length;
    if (consumed < words.length) lines[1] = lines[1].replace(/\s*$/, "…");
  }
  return lines;
}

export function bookCover(book: Pick<Book, "cover">): string | null {
  return book.cover ?? null;
}
