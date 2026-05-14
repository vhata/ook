import Link from "next/link";
import { HomeMark } from "@/components/HomeMark";
import { getAllBooks, getBingo, getCurrentBingoYear } from "@/lib/books";
import { buildShelfItems, computeSpineWidth } from "@/lib/shelf";
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
// Colour comes from a hash of the first tag (or first author when
// there's no tag), sampled from a small palette tuned to sit beside
// the paper-and-ink scheme.
//
// Markers ride on top of the spine:
//   - Books on the active bingo card carry a 2 px accent stripe along
//     the top edge.
//   - Currently-reading books carry a small bookmark tongue above the
//     shelf line.
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

// Eight spine colours, deliberately desaturated to sit beside the
// paper-and-ink palette. Tuned by eye in HSL for similar luminance so
// no spine yells louder than its neighbours.
const SPINE_COLORS = [
  "#8a4f3a", // rust-brown
  "#7e6a3e", // ochre
  "#3f6a4a", // forest
  "#3a5a78", // slate-blue
  "#5e3f6a", // plum
  "#7e3f4a", // garnet
  "#5e6a3f", // olive
  "#3f5a5e", // teal
];

function spineColor(book: Book): string {
  const seed = book.tags[0] ?? book.authors[0] ?? book.title;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % SPINE_COLORS.length;
  return SPINE_COLORS[idx];
}

function Spine({ book, onBingoCard }: { book: Book; onBingoCard: boolean }) {
  const fill = spineColor(book);
  const width = computeSpineWidth(book.pages);
  // Title length budget scales with width — narrow spines elide aggressively,
  // wide ones get more room. The SVG text runs along the spine's vertical
  // axis, so the budget here is roughly characters per ~SPINE_H pixels.
  const titleBudget = Math.max(16, Math.round((SPINE_H - 24) / 8));
  const titleShort = abbreviate(book.title, titleBudget);
  const rating = book.rating !== null ? "★".repeat(Math.floor(book.rating)) : "";
  const isReading = book.status === "reading";

  return (
    <Link
      href={`/books/${encodeURIComponent(book.slug)}`}
      title={`${book.title}${book.authors.length > 0 ? ` — ${book.authors.join(", ")}` : ""}${book.finished ? ` · ${book.finished}` : ""}${rating ? ` · ${rating}` : ""}${isReading ? " · currently reading" : ""}${onBingoCard ? " · on the bingo card" : ""}`}
      className="block shrink-0 transition-transform hover:-translate-y-1"
      aria-label={book.title}
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
        <rect x="0" y="8" width={width} height={SPINE_H} fill={fill} />
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
