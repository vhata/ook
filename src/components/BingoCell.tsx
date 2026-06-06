import Link from "next/link";
import type { BingoSquare } from "@/lib/types";

// One cell of the bingo grid. Shared by the desktop 5×5 grid and the
// mobile horizontal scroll-strip — the 5×5 shape stays sacred, the
// cell does not. The free square is a special-cased typographic tile.
//
// State markers on the corners:
//   done    — a gold star medallion, top-right: a filled star in a round
//             gold seal, ringed in the page surface colour so it reads as
//             a sticker lifted off the cover. Sized to be obvious when
//             scanning the whole grid for read squares; the cover image
//             stays visible underneath.
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

// Gold star medallion marking a read square. A filled star glyph sits in a
// round gold seal (`bg-star`) in the top-right corner of a done cell. The
// star takes the page surface colour so it stays high-contrast against the
// gold in both light and dark themes; a surface-colour ring plus a drop
// shadow lift the medallion off the cover so it reads as a sticker rather
// than a flat overlay. Deliberately large — the previous chip-scale marker
// was easy to miss when scanning the grid for which books are read.
function ReadStamp() {
  return (
    <div
      className="bg-star text-surface ring-surface absolute top-1 right-1 flex h-20 w-20 items-center justify-center rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.4)] ring-2"
      aria-label="read"
      data-testid="bingo-read-stamp"
    >
      <span aria-hidden="true" className="text-[42px] leading-none">
        ★
      </span>
    </div>
  );
}
