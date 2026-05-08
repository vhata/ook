import Link from "next/link";
import { getAllBooks } from "@/lib/books";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Shelf" };

type SearchParams = Promise<{ sort?: string }>;

const VALID_SORTS = new Set(["finished", "author", "rating", "title"]);

// /shelf — vertical SVG spines for every finished book, arranged
// shoulder-to-shoulder like a physical shelf strip. Each spine is a
// fixed-size rectangle with the title running up the spine and the
// author tucked at the foot. Colour comes from a hash of the first
// tag (or first author when there's no tag), sampled from a small
// palette that doesn't fight the paper-and-ink scheme.
//
// Without a `pages` field in the vault schema we can't size spines
// honestly. Future-self: when pages lands, scale height by sqrt(pages)
// for a more authentic shelf shape.

export default async function ShelfPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const sort = typeof sp.sort === "string" && VALID_SORTS.has(sp.sort) ? sp.sort : "finished";

  const all = await getAllBooks();
  const finished = all.filter((b) => b.status === "finished");
  const sorted = sortBooks(finished, sort);

  return (
    <main className="mx-auto box-border w-full max-w-[1200px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <Link
        href="/"
        className="border-rule text-ink-soft hover:text-ink mb-9 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← back
      </Link>

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

      {finished.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
          Nothing finished yet — the shelf is bare.
        </div>
      ) : (
        <Shelf books={sorted} />
      )}
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
    // finished (default): newest first
    out.sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? ""));
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

function Shelf({ books }: { books: Book[] }) {
  return (
    <div
      className="bg-surface border-rule overflow-x-auto rounded border p-5"
      // The shelf base — a thin rule below the spines suggests a wood plank.
      style={{ borderBottom: "3px solid var(--rule)" }}
    >
      <div className="flex items-end gap-[2px]">
        {books.map((b) => (
          <Spine key={b.slug} book={b} />
        ))}
      </div>
    </div>
  );
}

const SPINE_W = 32;
const SPINE_H = 220;

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

function Spine({ book }: { book: Book }) {
  const fill = spineColor(book);
  const titleShort = abbreviate(book.title, 28);
  const authorShort = abbreviate(book.authors[0] ?? "", 22);
  const rating = book.rating !== null ? "★".repeat(Math.floor(book.rating)) : "";

  return (
    <Link
      href={`/books/${encodeURIComponent(book.slug)}`}
      title={`${book.title}${book.authors.length > 0 ? ` — ${book.authors.join(", ")}` : ""}${book.finished ? ` · ${book.finished}` : ""}${rating ? ` · ${rating}` : ""}`}
      className="block shrink-0 transition-transform hover:-translate-y-1"
    >
      <svg
        width={SPINE_W}
        height={SPINE_H}
        viewBox={`0 0 ${SPINE_W} ${SPINE_H}`}
        aria-label={`${book.title} spine`}
      >
        {/* Spine background */}
        <rect x="0" y="0" width={SPINE_W} height={SPINE_H} fill={fill} />
        {/* Top + bottom decorative bands (the printer's rule) */}
        <rect x="0" y="6" width={SPINE_W} height="1" fill="rgba(255,255,255,0.25)" />
        <rect x="0" y={SPINE_H - 7} width={SPINE_W} height="1" fill="rgba(255,255,255,0.25)" />
        {/* Title — text origin at the spine centre, rotated -90° so
            it runs upward (book-spine convention). After the rotate,
            the text's natural x-axis is the spine's vertical axis. */}
        <text
          transform={`translate(${SPINE_W / 2}, ${SPINE_H / 2}) rotate(-90)`}
          textAnchor="middle"
          dy="4"
          fontFamily="ui-serif, serif"
          fontSize="11"
          fontWeight="500"
          fill="rgba(255,255,255,0.95)"
        >
          {titleShort}
        </text>
        {/* Author — at the foot, smaller, italic */}
        <text
          x={SPINE_W / 2}
          y={SPINE_H - 14}
          textAnchor="middle"
          fontFamily="ui-serif, serif"
          fontSize="6"
          fontStyle="italic"
          fill="rgba(255,255,255,0.7)"
        >
          {authorShort}
        </text>
      </svg>
    </Link>
  );
}

function abbreviate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
