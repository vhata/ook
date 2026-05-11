import Link from "next/link";
import type { BingoSquare } from "@/lib/types";

// One cell of the bingo grid. Shared by the desktop 5×5 grid and the
// mobile horizontal scroll-strip — the 5×5 shape stays sacred, the
// cell does not. The free square is a special-cased typographic tile.
//
// State markers on the corners:
//   done    — a small postal-stamp "READ" chip, top-right. Echoes the
//             Stamp component's visual language (accent border, small
//             caps, paper-and-ink) at chip scale. Reads as a quiet
//             celebration; the cover image stays visible underneath.
//   reading — a "now" pill, top-right, plus an accent ring around the
//             whole cell. Drives the eye in a way the cover-dim alone
//             couldn't.
//   neither — cover dimmed (opacity + grayscale + contrast) to push it
//             into the background of the grid.

export function BingoCellEl({ square }: { square: BingoSquare }) {
  if (square.free) {
    return (
      <div className="border-rule bg-surface-mute relative flex aspect-[0.7/1] flex-col items-center justify-center gap-1.5 overflow-hidden rounded border">
        <div className="font-serif text-accent text-[24px] italic">Free</div>
        <div className="text-ink-soft text-[9px] tracking-[0.16em] uppercase">any book</div>
      </div>
    );
  }
  const inner = (
    <>
      <div
        className={`bg-surface-mute w-full ${square.done || square.reading ? "" : "opacity-55 grayscale-[0.55] contrast-90"}`}
        style={{
          aspectRatio: "0.72 / 1",
          backgroundImage: square.cover ? `url(${square.cover})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="border-rule bg-surface border-t p-2">
        <div className="truncate text-[10px] leading-tight font-semibold">{square.title}</div>
        <div className="text-ink-soft truncate text-[9px]">{square.authors[0] ?? ""}</div>
      </div>
      <div className="bg-bg-raised text-ink absolute top-1 left-1.5 rounded-sm px-1 py-0.5 text-[8px] tracking-[0.12em]">
        {square.id}
      </div>
      {square.done && <ReadStamp />}
      {square.reading && !square.done && (
        <div className="bg-accent absolute top-1 right-1 rounded-sm px-1.5 py-0.5 text-[8px] tracking-[0.16em] text-white uppercase">
          now
        </div>
      )}
    </>
  );
  const baseClasses =
    "relative aspect-[0.7/1] overflow-hidden rounded border bg-surface transition-transform hover:-translate-y-0.5";
  const ringClasses = square.reading ? "border-accent ring-2 ring-accent" : "border-rule";
  const tooltip =
    square.authors.length > 0
      ? `${square.title ?? ""} — ${square.authors.join(", ")}`
      : (square.title ?? "");

  if (square.book) {
    return (
      <Link
        href={`/books/${encodeURIComponent(square.book)}`}
        className={`${baseClasses} ${ringClasses}`}
        title={tooltip}
        aria-label={tooltip}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className={`${baseClasses} ${ringClasses}`} title={tooltip} aria-label={tooltip}>
      {inner}
    </div>
  );
}

// Postal-stamp READ chip. Sits in the top-right corner of a done bingo
// cell. Accent-bordered rectangle, accent ink, small-caps READ with a
// star flourish — same visual idiom as the larger Stamp component used
// on per-book pages, sized down to fit a bingo corner without
// obscuring the cover. The slight backdrop-blur softens the cover
// behind it so the text stays legible against busy covers without an
// opaque overlay.
function ReadStamp() {
  return (
    <div
      className="border-accent bg-surface/85 text-accent absolute top-1 right-1 flex items-center gap-0.5 rounded-sm border px-1 py-[1px] text-[7px] font-semibold tracking-[0.18em] uppercase shadow-[0_1px_2px_rgba(0,0,0,0.15)] backdrop-blur-[1px]"
      aria-label="read"
      data-testid="bingo-read-stamp"
    >
      <span aria-hidden="true" className="text-star text-[8px] leading-none">
        ★
      </span>
      <span className="leading-none">Read</span>
    </div>
  );
}
