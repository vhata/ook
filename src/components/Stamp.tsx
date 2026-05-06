import type { Book } from "@/lib/types";

// Postal-stamp flourish for finished books. Rectangular SVG with a
// perforated dashed border (the stamp shape), title + author abbreviated
// to fit, finish date in 24-hour-clock format ("2026 · 05" reads like
// a postmark), and a star rating row. Server-component compatible.
//
// Sized small (about a thumbnail) so it sits as a flourish in the
// per-book header next to the cover, not as the dominant visual.

const STAMP_W = 96;
const STAMP_H = 120;
const PADDING = 8;

export function Stamp({ book }: { book: Book }) {
  if (book.status !== "finished") return null;

  const titleShort = abbreviate(book.title, 18);
  const authorShort = abbreviate(book.authors[0] ?? "", 16);
  const date = book.finished
    ? `${book.finished.slice(0, 4)} · ${book.finished.slice(5, 7)}`
    : "READ";
  const rating = book.rating ?? 0;
  const stars = Math.round(rating); // half-star rounded for the strip

  return (
    <svg
      width={STAMP_W}
      height={STAMP_H}
      viewBox={`0 0 ${STAMP_W} ${STAMP_H}`}
      role="img"
      aria-label={`${book.title} — ${book.finished ?? ""} stamp`}
      className="shrink-0 select-none"
    >
      {/* Perforated paper background */}
      <rect
        x="2"
        y="2"
        width={STAMP_W - 4}
        height={STAMP_H - 4}
        fill="var(--surface)"
        stroke="var(--rule)"
        strokeWidth="0.5"
      />
      {/* Inner ruled rectangle (the stamp's printed border) */}
      <rect
        x="6"
        y="6"
        width={STAMP_W - 12}
        height={STAMP_H - 12}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="0.7"
      />
      {/* Perforation dots along the four edges */}
      {perforations(STAMP_W, STAMP_H)}

      {/* Title (top), wrapped to two lines if very long */}
      <text
        x={STAMP_W / 2}
        y={PADDING + 14}
        textAnchor="middle"
        fontFamily="ui-serif, serif"
        fontSize="9"
        fontWeight="500"
        fill="var(--ink)"
      >
        {titleShort}
      </text>

      {/* Centre flourish: a row of stars, one per integer rating */}
      <text
        x={STAMP_W / 2}
        y={STAMP_H / 2 + 4}
        textAnchor="middle"
        fontFamily="ui-serif, serif"
        fontSize="14"
        fill="var(--accent)"
      >
        {stars > 0 ? "★".repeat(Math.min(5, stars)) : "·"}
      </text>

      {/* Author */}
      <text
        x={STAMP_W / 2}
        y={STAMP_H - PADDING - 22}
        textAnchor="middle"
        fontFamily="ui-serif, serif"
        fontSize="8"
        fontStyle="italic"
        fill="var(--ink-soft)"
      >
        {authorShort}
      </text>

      {/* Postmark date */}
      <text
        x={STAMP_W / 2}
        y={STAMP_H - PADDING - 6}
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize="8"
        letterSpacing="1"
        fill="var(--ink-soft)"
      >
        {date}
      </text>
    </svg>
  );
}

function abbreviate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function perforations(w: number, h: number): React.ReactElement[] {
  const dots: React.ReactElement[] = [];
  const r = 1.6;
  const step = 8;
  // Top and bottom edges
  for (let x = step; x < w - 2; x += step) {
    dots.push(<circle key={`t${x}`} cx={x} cy={2} r={r} fill="var(--bg)" />);
    dots.push(<circle key={`b${x}`} cx={x} cy={h - 2} r={r} fill="var(--bg)" />);
  }
  // Left and right edges
  for (let y = step; y < h - 2; y += step) {
    dots.push(<circle key={`l${y}`} cx={2} cy={y} r={r} fill="var(--bg)" />);
    dots.push(<circle key={`r${y}`} cx={w - 2} cy={y} r={r} fill="var(--bg)" />);
  }
  return dots;
}
