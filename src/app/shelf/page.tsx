import Link from "next/link";
import type { CSSProperties } from "react";
import { HomeMark } from "@/components/HomeMark";
import { getAllBooks, getBingo, getCurrentBingoYear } from "@/lib/books";
import { buildShelfItems, computeSpineWidth } from "@/lib/shelf";
import { spineStyle } from "@/lib/spine-color";
import { spineDecoration, type SpineDecoration, type SpineGlyph } from "@/lib/spine-decoration";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Shelf" };

type SearchParams = Promise<{ sort?: string }>;

const VALID_SORTS = new Set(["finished", "author", "rating", "title"]);

// /shelf — vertical SVG spines for every finished and currently-reading
// book, arranged shoulder-to-shoulder like a physical shelf strip.
//
// Each spine is a fixed-height rectangle whose width is derived from the
// book's page count (when known): `clamp(24, round(pages / 12), 72)` px.
// Real shelves vary wildly; uniform widths look web-y. Books without a
// `pages` value fall back to a default width — the formula degrades
// silently as the field is populated per-book.
//
// Colour comes from `spineColor` (`src/lib/spine-color.ts`): a hash of
// the book's first series membership (when present) or its title,
// projected through a curated set of bookshelf-register hue bands
// — burgundy, ochre, olive, forest, slate, navy, plum, with the warm
// bands deliberately over-weighted. Series members share a hue, like
// a publisher's uniform binding. Theme-aware via per-spine CSS
// custom-properties.
//
// Markers ride on top of the spine:
//   - Books on the active bingo card carry a 2 px accent stripe along
//     the top edge.
//   - Currently-reading books carry a small bookmark tongue above the
//     shelf line.
//
// A second axis of variety beyond hue: each spine may carry one
// decoration from `spine-decoration.ts` — cross-hatch overlay, stipple,
// chevron border, gilt edge, or a small foot glyph. Same series → same
// decoration (publisher uniform binding); ~35% of spines stay plain so
// the decorated ones read as accent, not clutter. Decorations are
// constrained to the spine body below y=24 so they never overlap the
// bingo stripe, title rule, or bookmark tongue.
//
// When sorted by finish date (the default), year boundaries get a small
// gap and a tick label below the shelf so the eye can find the seam in
// ~200 spines without breaking the timeline metaphor.

export default async function ShelfPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const sort = typeof sp.sort === "string" && VALID_SORTS.has(sp.sort) ? sp.sort : "finished";

  const [all, bingoYear] = await Promise.all([getAllBooks(), getCurrentBingoYear()]);
  const bingo = bingoYear !== null ? await getBingo(bingoYear) : null;
  const bingoSlugs = new Set<string>(
    (bingo?.squares ?? []).map((s) => s.book).filter((b): b is string => !!b),
  );

  // Currently-reading sits on the shelf alongside finished — the bookmark
  // tongue distinguishes them. Abandoned / paused are deliberately omitted
  // here; their treatment lands with the `/now` paused-state work.
  const shown = all.filter((b) => b.status === "finished" || b.status === "reading");
  const sorted = sortBooks(shown, sort);

  return (
    <main className="mx-auto box-border w-full max-w-[1200px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />
      <ShelfDefs />

      <header className="border-rule mb-8 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">Shelf</div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          Spines, in a row.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Every finished book as a vertical spine. Hover or tap for the title.
        </p>
        <SortLinks current={sort} />
      </header>

      {shown.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
          Nothing finished yet — the shelf is bare.
        </div>
      ) : (
        <Shelf books={sorted} sort={sort} bingoSlugs={bingoSlugs} />
      )}

      <WidthLegend />
    </main>
  );
}

function sortBooks(books: Book[], sort: string): Book[] {
  const out = [...books];
  if (sort === "author") {
    out.sort((a, b) => {
      const aa = (a.authors[0] ?? "").toLowerCase();
      const bb = (b.authors[0] ?? "").toLowerCase();
      return aa.localeCompare(bb) || a.title.localeCompare(b.title);
    });
  } else if (sort === "rating") {
    out.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title));
  } else if (sort === "title") {
    out.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    // finished (default): newest finish first. Currently-reading books
    // sort to the very front (most-recent interpretation); finished
    // books with no recorded date sort to the very end (we have no
    // signal where to place them, so they bottom out rather than
    // pollute the front via the old "9999" sentinel).
    const key = (b: Book): string => {
      if (b.status === "reading") return "9999-99-99";
      return b.finished ?? "";
    };
    out.sort((a, b) => key(b).localeCompare(key(a)) || a.title.localeCompare(b.title));
  }
  return out;
}

function SortLinks({ current }: { current: string }) {
  const opts: Array<{ key: string; label: string }> = [
    { key: "finished", label: "by finish date" },
    { key: "author", label: "by author" },
    { key: "rating", label: "by rating" },
    { key: "title", label: "by title" },
  ];
  return (
    <div className="text-ink-soft mt-5 flex flex-wrap items-center gap-3 text-[11px] tracking-[0.14em] uppercase">
      <span className="text-ink-dim">order</span>
      {opts.map((o, i) => (
        <span key={o.key} className="contents">
          <Link
            href={o.key === "finished" ? "/shelf" : `/shelf?sort=${o.key}`}
            className={
              current === o.key
                ? "text-ink decoration-accent underline underline-offset-[3px]"
                : "text-ink-soft hover:text-ink"
            }
          >
            {o.label}
          </Link>
          {i < opts.length - 1 && <span className="text-ink-dim">·</span>}
        </span>
      ))}
    </div>
  );
}

function Shelf({
  books,
  sort,
  bingoSlugs,
}: {
  books: Book[];
  sort: string;
  bingoSlugs: Set<string>;
}) {
  // Year separators are only meaningful when the row is in finish-date
  // order. Sorting by title or rating scrambles the chronology.
  const showYearBreaks = sort === "finished";
  const items = buildShelfItems(books, showYearBreaks);

  return (
    <div className="overflow-x-auto">
      {/* The shelf edge. A 1 px highlight on top + a 2 px shadow on the
          bottom commits to a real shelf instead of the previous outline
          box. The spines sit on the highlight; the shadow falls below. */}
      <div
        className="bg-surface relative"
        style={{
          paddingTop: "8px",
          paddingBottom: "20px",
          borderTop: "1px solid var(--rule)",
          boxShadow: "inset 0 -1px 0 var(--rule), 0 2px 4px -2px rgba(0,0,0,0.18)",
        }}
      >
        <div className="flex items-end gap-[1px]">
          {items.map((item, i) =>
            item.kind === "spine" ? (
              <Spine
                key={`${item.book.slug}-${i}`}
                book={item.book}
                onBingoCard={bingoSlugs.has(item.book.slug)}
              />
            ) : (
              <YearTick key={`year-${item.year}-${i}`} year={item.year} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

const SPINE_H = 220;

// Year tick — a 2 px horizontal gap on the spine row, with the year
// label set under the shelf rail so it reads as a date stripe instead
// of dropping a new row in the middle of the timeline.
function YearTick({ year }: { year: number }) {
  return (
    <div
      aria-label={`finished in ${year}`}
      className="relative shrink-0 self-stretch"
      style={{ width: "2px" }}
    >
      <span
        className="text-ink-dim absolute font-mono text-[9px] tracking-[0.08em]"
        style={{
          // Sit on the shelf bottom, centred over the gap.
          top: `${SPINE_H + 4}px`,
          left: "50%",
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
        }}
      >
        {year}
      </span>
    </div>
  );
}

function Spine({ book, onBingoCard }: { book: Book; onBingoCard: boolean }) {
  const width = computeSpineWidth(book.pages);
  // Title length budget scales with width — narrow spines elide aggressively,
  // wide ones get more room. The SVG text runs along the spine's vertical
  // axis, so the budget here is roughly characters per ~SPINE_H pixels.
  const titleBudget = Math.max(16, Math.round((SPINE_H - 24) / 8));
  const titleShort = abbreviate(book.title, titleBudget);
  const rating = book.rating !== null ? "★".repeat(Math.floor(book.rating)) : "";
  const isReading = book.status === "reading";
  const decoration = spineDecoration(book);

  return (
    <Link
      href={`/books/${encodeURIComponent(book.slug)}`}
      title={`${book.title}${book.authors.length > 0 ? ` — ${book.authors.join(", ")}` : ""}${book.finished ? ` · ${book.finished}` : ""}${rating ? ` · ${rating}` : ""}${isReading ? " · currently reading" : ""}${onBingoCard ? " · on the bingo card" : ""}`}
      className="block shrink-0 transition-transform hover:-translate-y-1"
      aria-label={book.title}
      style={spineStyle(book) as CSSProperties}
    >
      <svg
        width={width}
        // Extra headroom above the spine so the bookmark tongue has room
        // to extend up without being clipped.
        height={SPINE_H + 8}
        viewBox={`0 0 ${width} ${SPINE_H + 8}`}
      >
        {/* Bookmark tongue for currently-reading. Sits just above the
            spine, narrower than the spine itself, in the accent colour. */}
        {isReading && (
          <rect
            x={Math.max(2, Math.floor(width / 2) - 3)}
            y={0}
            width={6}
            height={10}
            fill="var(--accent)"
          />
        )}
        {/* Spine background — origin shifts down by 8 px to leave room
            for the bookmark tongue above. */}
        <rect x="0" y="8" width={width} height={SPINE_H} fill="var(--spine-color)" />
        {/* Decoration overlay — pure ornament, never load-bearing. Lives
            in the spine body (y=24 down) so it never collides with the
            bingo stripe, title rule, or bookmark tongue above. */}
        <SpineDecorationLayer decoration={decoration} width={width} />
        {/* Bingo-card accent stripe along the top edge of the spine. */}
        {onBingoCard && <rect x="0" y="8" width={width} height="2" fill="var(--accent)" />}
        {/* Top + bottom decorative bands (the printer's rule). */}
        <rect
          x="0"
          y={onBingoCard ? 12 : 14}
          width={width}
          height="1"
          fill="rgba(255,255,255,0.25)"
        />
        <rect x="0" y={SPINE_H + 1} width={width} height="1" fill="rgba(255,255,255,0.25)" />
        {/* Title. The text runs along the spine's vertical axis,
            top-to-bottom in the US/UK trade convention — when the
            book is laid flat with the cover up, the head tilts to
            the right. After the +90° rotate, the text's natural
            x-axis points downward along the spine. */}
        <text
          transform={`translate(${width / 2}, ${(SPINE_H + 8) / 2}) rotate(90)`}
          textAnchor="middle"
          dy="4"
          fontFamily="ui-serif, serif"
          fontSize="11"
          fontWeight="500"
          fill="rgba(255,255,255,0.95)"
        >
          {titleShort}
        </text>
      </svg>
    </Link>
  );
}

// The spine body proper starts at y=8 (the rect origin). The bingo
// stripe and title rule occupy y=8..y=14; the bookmark tongue lives at
// y=0..y=10. Decorations must not paint into those rows. The decoration
// zone is y=24..y=SPINE_H+8 (inclusive top, exclusive bottom in SVG
// coords) to leave a few pixels of breathing room under the title rule.
const DECORATION_TOP = 24;
const DECORATION_BOTTOM = SPINE_H + 6;

function SpineDecorationLayer({
  decoration,
  width,
}: {
  decoration: SpineDecoration | null;
  width: number;
}) {
  if (!decoration) return null;
  switch (decoration.kind) {
    case "cross-hatch":
      return (
        <rect
          x="0"
          y={DECORATION_TOP}
          width={width}
          height={DECORATION_BOTTOM - DECORATION_TOP}
          fill="url(#spine-cross-hatch)"
          opacity="0.55"
        />
      );
    case "stipple":
      return (
        <rect
          x="0"
          y={DECORATION_TOP}
          width={width}
          height={DECORATION_BOTTOM - DECORATION_TOP}
          fill="url(#spine-stipple)"
          opacity="0.55"
        />
      );
    case "chevron":
      // A vertical column of small chevrons running down the centre of
      // the spine, well below the title rule. Subtle — reads as
      // embossed cloth, not as a bullet list.
      return <ChevronDecoration width={width} />;
    case "gilt-edge":
      // A thin lighter rect along each long edge of the spine — mimics
      // gilded page edges peeking out from the binding.
      return (
        <>
          <rect
            x="0"
            y={DECORATION_TOP}
            width="1"
            height={DECORATION_BOTTOM - DECORATION_TOP}
            fill="rgba(255,240,200,0.55)"
          />
          <rect
            x={width - 1}
            y={DECORATION_TOP}
            width="1"
            height={DECORATION_BOTTOM - DECORATION_TOP}
            fill="rgba(255,240,200,0.55)"
          />
        </>
      );
    case "foot-glyph":
      return <FootGlyph glyph={decoration.glyph} width={width} />;
  }
}

function ChevronDecoration({ width }: { width: number }) {
  // Stack a few chevrons along the lower third so they don't compete
  // with the centred title. Centred horizontally; arrow-up shape, three
  // pixels wide.
  const cx = width / 2;
  const baseY = SPINE_H - 30;
  const chevrons = [0, 8, 16];
  return (
    <g fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" strokeLinecap="square">
      {chevrons.map((dy) => (
        <path
          key={dy}
          d={`M ${cx - 3} ${baseY + dy + 3} L ${cx} ${baseY + dy} L ${cx + 3} ${baseY + dy + 3}`}
        />
      ))}
    </g>
  );
}

function FootGlyph({ glyph, width }: { glyph: SpineGlyph; width: number }) {
  // Place the glyph near the foot of the spine, centred horizontally,
  // small enough to read as a publisher's mark rather than as a label.
  const cx = width / 2;
  const cy = SPINE_H - 8;
  const fill = "rgba(255,240,200,0.7)";
  switch (glyph) {
    case "asterisk":
      return (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="ui-serif, serif"
          fontSize="9"
          fill={fill}
        >
          ✻
        </text>
      );
    case "dot":
      return <circle cx={cx} cy={cy} r="1.4" fill={fill} />;
    case "diamond":
      return (
        <path
          d={`M ${cx} ${cy - 3} L ${cx + 2.5} ${cy} L ${cx} ${cy + 3} L ${cx - 2.5} ${cy} Z`}
          fill={fill}
        />
      );
    case "fleur":
      return (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="ui-serif, serif"
          fontSize="9"
          fill={fill}
        >
          ❦
        </text>
      );
    case "cross":
      return (
        <g stroke={fill} strokeWidth="1" strokeLinecap="square">
          <line x1={cx - 2} y1={cy} x2={cx + 2} y2={cy} />
          <line x1={cx} y1={cy - 2} x2={cx} y2={cy + 2} />
        </g>
      );
  }
}

// Page-level SVG `<defs>` holding the pattern definitions used by
// `<SpineDecorationLayer>`. Patterns are referenced via `url(#id)` from
// the per-spine SVGs. SVG `url(#…)` references resolve against the
// same HTML document, so a single hidden SVG at the page level is
// enough — no need to duplicate the defs in every spine.
function ShelfDefs() {
  return (
    <svg
      aria-hidden
      width="0"
      height="0"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        {/* Diagonal cross-hatch. 6-px tile, two thin strokes at 45°
            and -45°. Subtle off-white so it reads on every hue band. */}
        <pattern
          id="spine-cross-hatch"
          patternUnits="userSpaceOnUse"
          width="6"
          height="6"
          patternTransform="rotate(0)"
        >
          <path d="M 0 0 L 6 6" stroke="rgba(255,255,255,0.18)" strokeWidth="0.7" fill="none" />
          <path d="M 6 0 L 0 6" stroke="rgba(0,0,0,0.16)" strokeWidth="0.7" fill="none" />
        </pattern>
        {/* Stipple — small dots on a 5-px grid. Off-white over the
            spine fill reads as flecked cloth. */}
        <pattern id="spine-stipple" patternUnits="userSpaceOnUse" width="5" height="5">
          <circle cx="1.5" cy="1.5" r="0.6" fill="rgba(255,255,255,0.30)" />
          <circle cx="3.5" cy="3.5" r="0.45" fill="rgba(0,0,0,0.22)" />
        </pattern>
      </defs>
    </svg>
  );
}

function abbreviate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

// A small legend under the shelf that explains the visual markers
// (the accent strip and the bookmark tongue). Set in the same
// uppercase-tracking register as the sort links.
function WidthLegend() {
  return (
    <div className="text-ink-soft mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] tracking-[0.14em] uppercase">
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden
          className="inline-block"
          style={{ width: "10px", height: "2px", background: "var(--accent)" }}
        />
        bingo card
      </span>
      <span className="text-ink-dim">·</span>
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden
          className="inline-block"
          style={{ width: "4px", height: "8px", background: "var(--accent)" }}
        />
        currently reading
      </span>
    </div>
  );
}
